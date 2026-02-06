import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { ProvisionState } from '@prisma/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { ProcessOtpJobData } from '../services/queue.service';
import { provisionService } from '../services/provision.service';
import { sessionService } from '../services/session.service';
import { dockerService } from '../services/docker.service';
import whatsappAutomationService from '../services/whatsapp-automation.service';

const WORKER_VERSION = '3.2.3-french';
const logger = createChildLogger('otp-worker');

logger.info(`🚀 OTP Worker Version: ${WORKER_VERSION}`);

const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

async function processOtp(job: Job<ProcessOtpJobData>) {
  const { provisionId, requestId, otp } = job.data;
  
  logger.info({ provisionId, jobId: job.id, requestId, version: WORKER_VERSION }, 'Processing OTP injection');

  try {
    await provisionService.updateProvisionState(provisionId, ProvisionState.INJECTING_OTP);

    // Find the session for this provision
    const provision = await provisionService.getProvision(provisionId);
    if (!provision || !provision.sessions || provision.sessions.length === 0) {
      throw new Error('No session found for provision');
    }

    const session = provision.sessions[0];

    if (!session.appiumPort) {
      throw new Error('Appium port not found for session');
    }

    // Create a saveLog function for OTP injection logs
    const saveLog = async (message: string) => {
      try {
        await sessionService.createLog({
          sessionId: session.id,
          level: 'info',
          message,
          source: 'otp-injection',
        });
      } catch (e) {
        logger.warn({ error: e }, 'Failed to save log');
      }
    };

    // Inject OTP directly via Appium
    logger.info({ provisionId, sessionId: session.id, appiumPort: session.appiumPort }, 'Starting OTP injection');
    await saveLog('🔑 Démarrage du processus d\'injection OTP...');
    
    try {
      await whatsappAutomationService.injectOtp({
        appiumPort: session.appiumPort,
        otp,
        sessionId: session.id,
        onLog: saveLog,
      });
      
      logger.info({ provisionId, sessionId: session.id }, 'OTP injection completed successfully');
      await saveLog('✅ Injection OTP terminée !');
    } catch (otpInjectionError: any) {
      logger.error({ error: otpInjectionError.message, provisionId, sessionId: session.id }, 'OTP injection failed');
      await saveLog(`❌ Injection OTP échouée : ${otpInjectionError.message}`);
      throw otpInjectionError; // Re-throw to fail the job
    }

    // Move to COMPLETING_PROFILE state
    await provisionService.updateProvisionState(provisionId, ProvisionState.COMPLETING_PROFILE);
    await saveLog('✅ Code SMS saisi et configuration du profil terminée !');
    await job.updateProgress(50);

    // Wait for activation signal from agent (handled via WebSocket events)
    // For now, we'll wait a bit and check if the agent reports success
    await sleep(20000); // 20 seconds

    await job.updateProgress(80);

    // If linkToWeb is enabled, proceed with QR scan
    // TODO: Implement WhatsApp Web linking via Appium automation
    if (provision.linkToWeb) {
      logger.warn({ provisionId }, 'linkToWeb is enabled but not yet implemented with Appium automation');
      // await provisionService.updateProvisionState(provisionId, ProvisionState.LINKING_WEB);
      // TODO: Implement QR code scanning and linking
    }

    await job.updateProgress(85);

    // Activate session - WhatsApp account is now ready to use
    await sessionService.activateSession(session.id);
    await saveLog('✅ Compte WhatsApp activé et prêt à l\'emploi');
    
    // Move to TESTING_DEEPLINK state
    await provisionService.updateProvisionState(provisionId, ProvisionState.TESTING_DEEPLINK);
    await saveLog(`✅ Version du Worker : ${WORKER_VERSION}`);
    await saveLog('📤 Test d\'envoi de message via deeplink (pas de création de contact nécessaire)...');
    await job.updateProgress(90);
    
    const testPhoneNumber = '+972545879642';
    const testMessage = 'Bonjour ! Ceci est un message test automatique du système d\'automation WhatsApp.';
    
    try {
      await whatsappAutomationService.sendMessage({
        appiumPort: session.appiumPort,
        sessionId: session.id,
        to: testPhoneNumber,
        message: testMessage,
        containerId: session.containerName || undefined,
      });
      
      await saveLog(`✅ Message test envoyé avec succès via deeplink vers ${testPhoneNumber} !`);
      logger.info({ provisionId, sessionId: session.id, to: testPhoneNumber }, 'Test message sent via deeplink');
    } catch (msgError: any) {
      logger.error({ error: msgError.message, provisionId, sessionId: session.id }, 'Failed to send test message via deeplink');
      await saveLog(`⚠️ Échec d'envoi du message test : ${msgError.message}, mais la session est active`);
    }

    // Move to CREATING_SNAPSHOT state
    await provisionService.updateProvisionState(provisionId, ProvisionState.CREATING_SNAPSHOT);
    await saveLog('📸 Création du snapshot du profil WhatsApp...');
    await job.updateProgress(95);

    // Create snapshot AFTER sending message (Appium might die during snapshot)
    const snapshotPath = `/data/snapshots/${session.id}.tar.gz`;
    
    try {
      await dockerService.snapshotContainer(
        session.containerId!,
        snapshotPath
      );
      await sessionService.updateSessionSnapshot(session.id, snapshotPath);
      await saveLog('✅ Snapshot créé avec succès');
      logger.info({ provisionId, sessionId: session.id, snapshotPath }, 'Snapshot created');
    } catch (snapshotError: any) {
      logger.warn({ error: snapshotError.message, provisionId, sessionId: session.id }, 'Failed to create snapshot, continuing anyway');
      await saveLog(`⚠️ Échec de création du snapshot : ${snapshotError.message}, mais on continue...`);
    }

    // Finally mark as ACTIVE
    await provisionService.updateProvisionState(provisionId, ProvisionState.ACTIVE);
    await saveLog('🎉 Le compte WhatsApp est maintenant entièrement actif et prêt à l\'emploi !');
    await job.updateProgress(100);

    logger.info({ provisionId, sessionId: session.id }, 'OTP processing completed');

    return { 
      success: true, 
      sessionId: session.id,
    };
  } catch (error) {
    logger.error({ error, provisionId, requestId }, 'OTP processing failed');
    
    await provisionService.updateProvisionState(
      provisionId,
      ProvisionState.FAILED,
      error instanceof Error ? error.message : 'Unknown error'
    );

    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Create worker
export const otpWorker = new Worker<ProcessOtpJobData>(
  'otp',
  processOtp,
  {
    connection,
    concurrency: 5,
  }
);

otpWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, provisionId: job.data.provisionId }, 'OTP job completed');
});

otpWorker.on('failed', (job, err) => {
  logger.error({ 
    jobId: job?.id, 
    provisionId: job?.data.provisionId, 
    error: err 
  }, 'OTP job failed');
});

logger.info('OTP worker started');



