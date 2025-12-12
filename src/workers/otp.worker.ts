import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import axios from 'axios';
import { ProvisionState } from '@prisma/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { ProcessOtpJobData } from '../services/queue.service';
import { provisionService } from '../services/provision.service';
import { sessionService } from '../services/session.service';
// import { dockerService } from '../services/docker.service'; // Not needed - snapshot disabled
import whatsappAutomationService from '../services/whatsapp-automation.service';

const WORKER_VERSION = '3.87.0-ANDROID-13';
const logger = createChildLogger('otp-worker');

logger.info(`🚀 OTP Worker Version: ${WORKER_VERSION}`);

// Helper function to broadcast WebSocket events via API
async function broadcastEvent(event: string, data: any) {
  try {
    await axios.post(`http://wa-api:3000/provision/broadcast`, {
      event,
      data
    });
  } catch (error) {
    logger.error({ error, event, data }, 'Échec de diffusion de l\'événement');
  }
}

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
        
        // Broadcast log to frontend in real-time for Live Logs display
        await broadcastEvent('session_log', {
          sessionId: session.id,
          message,
          source: 'otp-injection',
          level: 'info',
          timestamp: new Date().toISOString(),
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

    // No need to wait - injectOtp already verifies WhatsApp activation
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
    
    await saveLog(`✅ Version du Worker : ${WORKER_VERSION}`);
    await saveLog('✅ Le compte WhatsApp est maintenant actif !');
    
    await job.updateProgress(90);
    
    // TEST: Attempt to create a contact and send a test message
    await saveLog('🧪 Test automatique: Création d\'un contact...');
    try {
      const contactSuccess = await whatsappAutomationService.createWhatsAppContact({
        appiumPort: session.appiumPort!,
        sessionId: session.id,
        phoneNumber: '544463186', // Test number as requested
        firstName: undefined, // Will generate random
        lastName: undefined, // Will generate random
        onLog: async (msg: string) => {
          await saveLog(msg);
        },
      });
      
      if (contactSuccess) {
        await saveLog('✅ Contact créé et message de test envoyé avec succès !');
      } else {
        await saveLog('⚠️ La création du contact n\'a pas pu être complétée (voir logs ci-dessus)');
      }
    } catch (contactError: any) {
      await saveLog(`⚠️ Échec du test de contact: ${contactError.message}`);
      // Don't fail the whole job if contact creation fails - it's just a test
    }
    
    await job.updateProgress(95);

    // Mark as ACTIVE immediately
    await provisionService.updateProvisionState(provisionId, ProvisionState.ACTIVE);
    await saveLog('🎉 Le compte WhatsApp est maintenant entièrement actif et prêt à l\'emploi !');
    
    // CRITICAL: Update progress to 100 BEFORE returning to ensure job completion is signaled
    await job.updateProgress(100);

    logger.info({ provisionId, sessionId: session.id, jobId: job.id }, '✅ OTP job completed successfully - account is active - RETURNING NOW');
    
    // Return result object - BullMQ will use this to signal completion
    const result = { 
      success: true, 
      sessionId: session.id,
      provisionId,
      completed: true,
    };
    
    logger.info({ result, jobId: job.id }, 'OTP job returning result');
    return result;
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

// Sleep function removed - no longer needed

// Create worker
export const otpWorker = new Worker<ProcessOtpJobData>(
  'otp',
  processOtp,
  {
    connection,
    concurrency: 5,
  }
);

otpWorker.on('completed', (job, result) => {
  // DO NOT make this async - just log and return immediately
  logger.info({ jobId: job.id, provisionId: job.data.provisionId, result }, 'OTP job completed successfully');
  // NO message sending here - it will be triggered manually from frontend or API
});

otpWorker.on('failed', (job, err) => {
  logger.error({ 
    jobId: job?.id, 
    provisionId: job?.data.provisionId, 
    error: err 
  }, 'OTP job failed');
});

logger.info('OTP worker started');



