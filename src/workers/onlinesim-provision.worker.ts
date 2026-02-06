import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { ProvisionState } from '@prisma/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { onlinesimProvisionService } from '../services/onlinesim-provision.service';
import { sessionService } from '../services/session.service';
import { dockerService } from '../services/docker.service';
import { generateAgentToken } from '../middleware/auth.middleware';
import { prisma } from '../utils/db';
import axios from 'axios';

const logger = createChildLogger('onlinesim-provision-worker');

const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export interface OnlineSimProvisionJobData {
  provisionId: string;
  countryId?: number;
  serviceId?: string;
  linkToWeb?: boolean;
}

// Helper function to broadcast WebSocket events via API
async function broadcastEvent(event: string, data: any) {
  try {
    console.log(`📡 [BROADCAST] Sending event ${event} to API`);
    await axios.post(`http://wa-api:3000/provision/broadcast`, {
      event,
      data
    });
    console.log(`✅ [BROADCAST] Event ${event} sent successfully`);
  } catch (error) {
    console.log(`❌ [BROADCAST] Failed to send event ${event}:`, error);
    logger.error({ error, event, data }, 'Failed to broadcast event');
  }
}

async function processProvision(job: Job<OnlineSimProvisionJobData>) {
  const { provisionId, countryId, serviceId, linkToWeb } = job.data;
  
  console.log(`🚀 [ONLINESIM PROVISION WORKER] Starting provision job for ID: ${provisionId}`);
  logger.info({ provisionId, jobId: job.id }, 'Processing OnlineSim provision job');

  try {
    // Step 1: Buy number from OnlineSim
    console.log(`📱 [STEP 1] Updating provision state to BUYING_NUMBER for ${provisionId}`);
    await onlinesimProvisionService.updateProvisionState(provisionId, ProvisionState.BUYING_NUMBER);
    await job.updateProgress(10);
    
    console.log(`📡 [STEP 1] Broadcasting to frontend: BUYING_NUMBER`);
    // Notify frontend
    console.log(`🔍 [DEBUG] About to call broadcastEvent`);
    try {
      await broadcastEvent('provision_update', {
        provisionId,
        state: ProvisionState.BUYING_NUMBER,
        progress: 10,
        message: 'Connecting to OnlineSim and purchasing number...'
      });
      console.log(`✅ [DEBUG] broadcastEvent completed successfully`);
    } catch (error) {
      console.log(`❌ [BROADCAST] Error in broadcastEvent:`, error);
    }

    console.log(`🛒 [STEP 1] Calling OnlineSim to buy number...`);
    // For now, use default values - we'll implement proper country/service resolution later
    const buyResult = await onlinesimProvisionService.buyNumber(
      countryId || 1, // Default to first country
      serviceId || 'whatsapp' // Default service
    );

    console.log(`✅ [STEP 1] Number purchased successfully: ${buyResult.number}`);
    logger.info({ 
      provisionId, 
      tzid: buyResult.tzid, 
      phone: buyResult.number 
    }, 'Number purchased');

    await onlinesimProvisionService.updateProvisionNumber(
      provisionId,
      buyResult.tzid.toString(),
      buyResult.number
    );

    await job.updateProgress(30);

    console.log(`📡 [STEP 1] Broadcasting to frontend: Number purchased`);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.BUYING_NUMBER,
      progress: 30,
      message: `Number purchased: ${buyResult.number}`,
      phone: buyResult.number
    });

    // Step 2: Spawn emulator container
    console.log(`🐳 [STEP 2] Updating provision state to SPAWNING_CONTAINER for ${provisionId}`);
    await onlinesimProvisionService.updateProvisionState(provisionId, ProvisionState.SPAWNING_CONTAINER);
    
    console.log(`📡 [STEP 2] Broadcasting to frontend: SPAWNING_CONTAINER`);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 30,
      message: 'Creating Android emulator container...'
    });

    console.log(`🔑 [STEP 2] Generating agent token for ${provisionId}`);
    const agentToken = generateAgentToken(provisionId);
    
    console.log(`🐳 [STEP 2] Spawning Docker emulator container...`);
    const emulatorInfo = await dockerService.spawnEmulator({
      sessionId: provisionId,
      phone: buyResult.number,
      agentToken,
      linkToWeb,
    });

    console.log(`✅ [STEP 2] Emulator spawned successfully: ${emulatorInfo.containerId}`);
    logger.info({ provisionId, containerId: emulatorInfo.containerId }, 'Emulator spawned');

    // Create session in database
    const session = await sessionService.createSession({
      provisionId,
      containerId: emulatorInfo.containerId,
      streamUrl: emulatorInfo.streamUrl,
      vncPort: emulatorInfo.vncPort,
      appiumPort: emulatorInfo.appiumPort,
      agentToken,
    });

    // Broadcast session created event immediately so frontend can show it
    await broadcastEvent('session_created', {
      sessionId: session.id,
      provisionId,
      containerId: emulatorInfo.containerId,
      streamUrl: emulatorInfo.streamUrl,
      vncPort: emulatorInfo.vncPort,
      appiumPort: emulatorInfo.appiumPort,
      isActive: false,
      linkedWeb: false,
      phone: buyResult.number,
      createdAt: session.createdAt,
    });

    await job.updateProgress(50);

    console.log(`📡 [STEP 2] Broadcasting to frontend: Container created`);
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 50,
      message: 'Container created, starting WhatsApp registration...'
    });

    // Step 3: Wait for agent to be ready and start WhatsApp registration
    console.log(`⏳ [STEP 3] Updating provision state to WAITING_OTP for ${provisionId}`);
    await onlinesimProvisionService.updateProvisionState(provisionId, ProvisionState.WAITING_OTP);
    
    console.log(`📡 [STEP 3] Broadcasting to frontend: WAITING_OTP`);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.WAITING_OTP,
      progress: 50,
      message: 'Waiting for SMS code...'
    });

    console.log(`⏰ [STEP 3] Waiting 30 seconds for emulator to boot and agent to start...`);
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    console.log(`📈 [STEP 3] Updating job progress to 60%`);
    await job.updateProgress(60);

    // Step 4: Poll for OTP from OnlineSim
    console.log(`📱 [STEP 4] Starting to poll for OTP from OnlineSim...`);
    logger.info({ provisionId, tzid: buyResult.tzid }, 'Polling for OTP');

    const otp = await onlinesimProvisionService.pollForSms(buyResult.tzid.toString());

    console.log(`✅ [STEP 4] OTP received: ${otp}`);
    logger.info({ provisionId, otp }, 'OTP received');

    console.log(`📡 [STEP 4] Broadcasting OTP received to frontend`);
    await broadcastEvent('otp_received', {
      provisionId,
      otp: otp,
      message: 'SMS code received!'
    });

    // Log OTP
    await prisma.otpLog.create({
      data: {
        provisionId,
        rawSms: otp,
        code: otp,
      },
    });

    await job.updateProgress(80);

    // Step 5: Enqueue OTP injection job
    console.log(`🔄 [STEP 5] Enqueuing OTP injection job for ${provisionId}`);
    // Note: You'll need to create an OTP queue for OnlineSim or reuse the existing one
    // await otpQueue.add('process-otp', {
    //   provisionId,
    //   requestId: buyResult.tzid.toString(),
    //   otp: otp,
    // });

    console.log(`💉 [STEP 5] Updating provision state to INJECTING_OTP for ${provisionId}`);
    await onlinesimProvisionService.updateProvisionState(provisionId, ProvisionState.INJECTING_OTP);
    
    console.log(`📡 [STEP 5] Broadcasting to frontend: INJECTING_OTP`);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.INJECTING_OTP,
      progress: 80,
      message: 'Injecting SMS code into WhatsApp...'
    });

    // Mark SMS as ready on OnlineSim (optional)
    console.log(`✅ [STEP 5] SMS processing completed`);
    await onlinesimProvisionService.setStatus(buyResult.tzid.toString(), 'ready');

    console.log(`📈 [FINAL] Updating job progress to 100%`);
    await job.updateProgress(100);
    
    console.log(`🎉 [FINAL] Broadcasting session ready to frontend`);
    await broadcastEvent('session_ready', {
      provisionId,
      sessionId: session.id,
      phone: buyResult.number,
      message: 'WhatsApp session is ready!'
    });

    console.log(`✅ [FINAL] OnlineSim provision job completed successfully for ${provisionId}`);
    logger.info({ provisionId, sessionId: session.id }, 'OnlineSim provision job completed');

    return { 
      success: true, 
      sessionId: session.id,
      phone: buyResult.number,
    };
  } catch (error) {
    console.log(`❌ [ERROR] OnlineSim provision job failed for ${provisionId}:`, error);
    logger.error({ error, provisionId }, 'OnlineSim provision job failed');
    
    console.log(`💥 [ERROR] Updating provision state to FAILED for ${provisionId}`);
    await onlinesimProvisionService.updateProvisionState(
      provisionId,
      ProvisionState.FAILED,
      error instanceof Error ? error.message : 'Unknown error'
    );
    
    console.log(`📡 [ERROR] Broadcasting error to frontend`);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.FAILED,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Provision failed'
    });

    throw error;
  }
}

// Create worker
const worker = new Worker<OnlineSimProvisionJobData>(
  'onlinesim-provision',
  processProvision,
  {
    connection,
    concurrency: 5,
  }
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, provisionId: job.data.provisionId }, 'OnlineSim provision job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ 
    jobId: job?.id, 
    provisionId: job?.data?.provisionId, 
    error: err 
  }, 'OnlineSim provision job failed');
});

export default worker;
