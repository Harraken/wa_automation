import { Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { ProvisionState } from '@prisma/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { ProvisionJobData, otpQueue } from '../services/queue.service';
import { provisionService } from '../services/provision.service';
import { sessionService } from '../services/session.service';
import { dockerService } from '../services/docker.service';
import whatsappAutomationService from '../services/whatsapp-automation.service';
import { generateAgentToken } from '../middleware/auth.middleware';
import { SmsManAdapter } from '../providers/smsman';
import { OnlineSimAdapter } from '../providers/onlinesim';
import { prisma } from '../utils/db';
import axios from 'axios';

const logger = createChildLogger('provision-worker');

const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

const onlineSimAdapter = new OnlineSimAdapter({
  apiKey: config.onlinesim.apiKey,
  baseUrl: config.onlinesim.baseUrl,
  pollIntervalMs: config.onlinesim.pollIntervalMs,
  pollTimeoutMs: config.onlinesim.pollTimeoutMs,
});

const smsManAdapter = new SmsManAdapter({
  token: config.smsMan.token,
  apiUrl: config.smsMan.apiUrl,
  pollIntervalMs: config.smsMan.pollIntervalMs,
  pollTimeoutMs: config.smsMan.pollTimeoutMs,
});

// Create QueueEvents for waiting on job completion
const otpQueueEvents = new QueueEvents('otp-queue', {
  connection: new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,
  }),
});

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

// Helper function to save logs
async function saveLog(sessionId: string, level: 'info' | 'warn' | 'error', message: string, source: string, metadata?: any) {
  try {
    await sessionService.createLog({
      sessionId,
      level,
      message,
      source,
      metadata,
    });
  } catch (error) {
    logger.warn({ error, sessionId }, 'Échec de sauvegarde du log');
  }
}

/**
 * Get United States country ID from SMS-MAN with fallbacks
 */
async function getUnitedStatesCountryId(): Promise<string> {
  try {
    return await smsManAdapter.getCountryId('United States');
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to get "United States", trying "USA"...');
    try {
      return await smsManAdapter.getCountryId('USA');
    } catch (usaError: any) {
      logger.error({ error: error.message, usaError: usaError.message }, 'Failed to get United States country ID from SMS-MAN');
      // Use default fallback - SMS-MAN US is typically country ID "0" or "1"
      return '0';
    }
  }
}

/**
 * Determine provider and country ID - simplified logic
 */
async function determineProviderAndCountryId(countryId?: string): Promise<{ 
  provider: 'ONLINESIM' | 'SMS-MAN'; 
  countryId: string; 
  countryName: string | null;
}> {
  const countryIdStr = String(countryId || '').trim();
  
  // Test OnlineSim availability first
  logger.info('Testing OnlineSim availability...');
  let onlineSimAvailable = false;
  try {
    await onlineSimAdapter.getCountries();
    onlineSimAvailable = true;
    logger.info('OnlineSim is available');
  } catch (error: any) {
    const isTryAgain = error.message?.includes('TRY_AGAIN_LATER');
    if (isTryAgain) {
      logger.warn({ error: error.message }, 'OnlineSim unavailable (TRY_AGAIN_LATER), will use SMS-MAN');
      onlineSimAvailable = false;
    } else {
      logger.warn({ error: error.message }, 'OnlineSim test failed but not TRY_AGAIN_LATER, will still try');
      onlineSimAvailable = true;
    }
  }
  
  // If country was specified, use it
  if (countryIdStr && countryIdStr !== '') {
    const isNumericId = !isNaN(Number(countryIdStr));
    
    if (isNumericId) {
      // Numeric ID - try OnlineSim first if available, else SMS-MAN
      if (onlineSimAvailable) {
        return { provider: 'ONLINESIM', countryId: countryIdStr, countryName: null };
      } else {
        const smsManCountryId = await getUnitedStatesCountryId();
        return { provider: 'SMS-MAN', countryId: smsManCountryId, countryName: null };
      }
    } else {
      // Country name - resolve it
      if (onlineSimAvailable) {
        try {
          const onlineSimCountryId = await onlineSimAdapter.getCountryId(countryIdStr);
          return { provider: 'ONLINESIM', countryId: onlineSimCountryId.toString(), countryName: countryIdStr };
        } catch (error: any) {
          logger.warn({ error: error.message, country: countryIdStr }, 'OnlineSim failed for specified country, using SMS-MAN');
          const smsManCountryId = await smsManAdapter.getCountryId(countryIdStr);
          return { provider: 'SMS-MAN', countryId: smsManCountryId, countryName: null };
        }
      } else {
        const smsManCountryId = await smsManAdapter.getCountryId(countryIdStr);
        return { provider: 'SMS-MAN', countryId: smsManCountryId, countryName: null };
      }
    }
  }
  
  // No country specified - try multiple countries in cascade
  // Priority: United States → Canada → France → United Kingdom → Germany
  const countryCascade = [
    'United States',
    'Canada', 
    'France',
    'United Kingdom',
    'Germany'
  ];
  
  logger.info({ countryCascade }, '🌍 No country specified, trying countries in cascade...');
  
  for (const countryName of countryCascade) {
    logger.info({ country: countryName }, `🔍 Trying ${countryName}...`);
    
    // Try SMS-MAN first for this country
    try {
      const smsManCountryId = await smsManAdapter.getCountryId(countryName);
      
      // Check if numbers are available
      const prices = await smsManAdapter.getPrices(
        smsManCountryId,
        await smsManAdapter.getWhatsAppApplicationId()
      );
      
      if (prices && prices.count > 0) {
        logger.info({ country: countryName, countryId: smsManCountryId, count: prices.count }, `✅ ${countryName} available on SMS-MAN (${prices.count} numbers)`);
        return { provider: 'SMS-MAN', countryId: smsManCountryId, countryName };
      } else {
        logger.info({ country: countryName }, `⚠️ ${countryName} - no numbers on SMS-MAN, trying OnlineSim...`);
      }
    } catch (smsManError: any) {
      logger.warn({ country: countryName, error: smsManError.message }, `⚠️ SMS-MAN error for ${countryName}`);
    }
    
    // Try OnlineSim if SMS-MAN failed or no numbers
    if (onlineSimAvailable) {
      try {
        const onlineSimCountryId = await onlineSimAdapter.getCountryId(countryName);
        const services = await onlineSimAdapter.getServices(onlineSimCountryId);
        
        const whatsappService = services.find(s => 
          s.service_text.toLowerCase().includes('whatsapp') ||
          s.service_text.toLowerCase().includes('whats app')
        );
        
        if (whatsappService && whatsappService.count > 0) {
          logger.info({ country: countryName, countryId: onlineSimCountryId, count: whatsappService.count }, `✅ ${countryName} available on OnlineSim (${whatsappService.count} numbers)`);
          return { provider: 'ONLINESIM', countryId: onlineSimCountryId.toString(), countryName };
        } else {
          logger.info({ country: countryName }, `⚠️ ${countryName} - no numbers on OnlineSim`);
        }
      } catch (onlineSimError: any) {
        const isTryAgain = onlineSimError.message?.includes('TRY_AGAIN_LATER');
        if (isTryAgain) {
          logger.warn({ country: countryName }, `⚠️ OnlineSim rate-limited for ${countryName}`);
        } else {
          logger.warn({ country: countryName, error: onlineSimError.message }, `⚠️ OnlineSim error for ${countryName}`);
        }
      }
    }
    
    logger.warn({ country: countryName }, `❌ ${countryName} - no numbers available on any provider, trying next country...`);
  }
  
  // If we get here, all countries failed
  throw new Error(`No numbers available in any country: ${countryCascade.join(', ')}`);
}

async function processProvision(job: Job<ProvisionJobData>) {
  const { provisionId, countryId, applicationId, linkToWeb } = job.data;
  
  logger.info({ provisionId, jobId: job.id }, 'Processing provision job');

  try {
    // Step 0: Cleanup expired TZIDs before starting
    const { phoneNumberService } = await import('../services/phone-number.service');
    const cleanedCount = await phoneNumberService.cleanupExpiredTzids();
    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Cleaned up expired TZIDs');
    }

    // Ensure provision doesn't have an existing phone number - clear it if it does
    const existingProvision = await provisionService.getProvision(provisionId);
    if (existingProvision && existingProvision.phone) {
      logger.warn({ provisionId, existingPhone: existingProvision.phone }, 'Provision already has a phone number, clearing it before buying new number');
      await prisma.provision.update({
        where: { id: provisionId },
        data: { phone: null },
      });
    }

    // CRITICAL: Check if a session already exists for this provision to prevent duplicates on retry
    const existingSessions = await prisma.session.findMany({
      where: { provisionId },
      orderBy: { createdAt: 'desc' },
    });
    
    let session;
    
    if (existingSessions.length > 0) {
      logger.error({ 
        provisionId, 
        sessionCount: existingSessions.length,
        sessions: existingSessions.map(s => ({ id: s.id, createdAt: s.createdAt }))
      }, 'DUPLICATE SESSION DETECTED! Session(s) already exist for this provision. This indicates a retry or duplicate job execution.');
      
      // STOP: Do not create another container/session
      throw new Error(`Duplicate job execution prevented: ${existingSessions.length} session(s) already exist for provision ${provisionId}. Please delete existing sessions before retrying.`);
    }
    
    // Step 1: Create container FIRST
    await provisionService.updateProvisionState(provisionId, ProvisionState.SPAWNING_CONTAINER);
    await job.updateProgress(10);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 12,
      message: 'Création du conteneur Android émulateur...'
    });
    
    const agentToken = generateAgentToken(provisionId);
    const emulatorInfo = await dockerService.spawnEmulator({
      sessionId: provisionId,
      phone: 'PENDING', // Placeholder, will be updated after number purchase
      agentToken,
      linkToWeb,
    });
    
    logger.info({ provisionId, containerId: emulatorInfo.containerId }, 'Emulator spawned');
    
    // Create session in database (without phone number yet)
    session = await sessionService.createSession({
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
      phone: null,
      state: ProvisionState.SPAWNING_CONTAINER,
      createdAt: session.createdAt,
    });
    
    await saveLog(session.id, 'info', '📦 Conteneur créé, préparation au lancement de WhatsApp...', 'provision');
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 15,
      message: `Conteneur créé, lancement de WhatsApp...`
    });
    
    await job.updateProgress(18);
    
    // Step 2: Determine provider and country ID (but don't buy yet!)
    let provider: 'ONLINESIM' | 'SMS-MAN';
    let finalCountryId: string;
    let countryNameForOnlineSim: string | null;
    
    try {
      const result = await determineProviderAndCountryId(countryId);
      provider = result.provider;
      finalCountryId = result.countryId;
      countryNameForOnlineSim = result.countryName;
    } catch (error: any) {
      // If determineProviderAndCountryId fails (e.g., TRY_AGAIN_LATER), fallback to SMS-MAN
      const isTryAgain = error.message?.includes('TRY_AGAIN_LATER');
      if (isTryAgain) {
        logger.warn({ error: error.message }, 'determineProviderAndCountryId returned TRY_AGAIN_LATER, using SMS-MAN fallback');
        provider = 'SMS-MAN';
        finalCountryId = await getUnitedStatesCountryId();
        countryNameForOnlineSim = null;
      } else {
        // Re-throw other errors
        throw error;
      }
    }
    
    logger.info({ provider, countryId: finalCountryId, countryName: countryNameForOnlineSim }, 'Provider and country determined (will buy when WhatsApp is ready)');
    
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.LAUNCHING_WHATSAPP,
      progress: 20,
      message: `🚀 Lancement de WhatsApp (numéro sera acheté quand prêt)...`
    });
    
    // Step 3: Define callback to buy number ONLY when WhatsApp shows phone entry screen
    let buyResult: any = null;
    let phoneNumberId: string | null = null;
    
    const buyNumberCallback = async () => {
      if (buyResult) {
        return buyResult; // Already bought
      }
      
      logger.info({ provider, countryId: finalCountryId }, '📞 WhatsApp is ready for phone number! Buying number NOW...');
      await saveLog(session.id, 'info', `📞 WhatsApp a atteint l'écran de saisie du téléphone, achat d'un numéro ${provider} maintenant...`, 'provision');
      await broadcastEvent('provision_update', {
        provisionId,
        sessionId: session.id,
        state: ProvisionState.BUYING_NUMBER,
        progress: 30,
        message: `📞 Achat d'un numéro depuis ${provider}...`
      });
      
      if (provider === 'ONLINESIM') {
        try {
          const onlineSimCountryId = countryNameForOnlineSim 
            ? await onlineSimAdapter.getCountryId(countryNameForOnlineSim)
            : Number(finalCountryId);
          
          let serviceId: string;
          try {
            serviceId = await onlineSimAdapter.getWhatsAppServiceId(onlineSimCountryId);
          } catch (getServiceIdError: any) {
            const isTryAgain = getServiceIdError.message?.includes('TRY_AGAIN_LATER');
            if (isTryAgain) {
              logger.warn({ error: getServiceIdError.message }, 'getWhatsAppServiceId returned TRY_AGAIN_LATER, skipping OnlineSim');
              throw new Error('SKIP_TO_SMS_MAN');
            }
            throw getServiceIdError;
          }
          
          const onlineSimResult = await onlineSimAdapter.buyNumber(onlineSimCountryId, serviceId);
          
          buyResult = {
            request_id: onlineSimResult.tzid.toString(),
            number: onlineSimResult.number,
          };
          
          try {
            phoneNumberId = await phoneNumberService.savePhoneNumber({
              phone: buyResult.number,
              requestId: buyResult.request_id,
              provider: 'ONLINESIM',
              countryId: finalCountryId,
            });
          } catch (saveError: any) {
            // Ignore duplicate errors
          }
        } catch (error: any) {
          const isSkipSignal = error.message === 'SKIP_TO_SMS_MAN';
          const isTryAgain = error.message?.includes('TRY_AGAIN_LATER');
          
          if (isSkipSignal || isTryAgain) {
            logger.warn({ error: error.message }, 'OnlineSim unavailable, falling back to SMS-MAN');
          } else {
            logger.error({ error: error.message }, 'OnlineSim purchase failed, falling back to SMS-MAN');
          }
          
            const smsManCountryId = await getUnitedStatesCountryId();
            buyResult = await smsManAdapter.buyNumber(
              smsManCountryId,
              applicationId || await smsManAdapter.getWhatsAppApplicationId()
            );
            
            try {
              phoneNumberId = await phoneNumberService.savePhoneNumber({
                phone: buyResult.number,
                requestId: buyResult.request_id,
                provider: 'SMS-MAN',
                countryId: smsManCountryId,
              });
            } catch (saveError: any) {
            // Ignore
          }
        }
      } else {
        // SMS-MAN (primary for direct purchase)
        logger.info({ provider: 'SMS-MAN', countryId: finalCountryId }, '🔄 Attempting to purchase number from SMS-MAN...');
        await saveLog(session.id, 'info', `📞 Attempting SMS-MAN purchase (country: ${finalCountryId})...`, 'provision');
          
          try {
            buyResult = await smsManAdapter.buyNumber(
            finalCountryId,
              applicationId || await smsManAdapter.getWhatsAppApplicationId()
            );
            
          logger.info({ number: buyResult.number, requestId: buyResult.request_id }, '✅ Achat SMS-MAN réussi');
          await saveLog(session.id, 'info', `✅ Achat SMS-MAN réussi : ${buyResult.number}`, 'provision');
            
            try {
              phoneNumberId = await phoneNumberService.savePhoneNumber({
                phone: buyResult.number,
                requestId: buyResult.request_id,
                provider: 'SMS-MAN',
              countryId: finalCountryId,
              });
            } catch (saveError: any) {
              // Ignore duplicate errors
            }
          } catch (error: any) {
          logger.error({ 
              error: error.message,
            errorStack: error.stack,
              provider: 'SMS-MAN',
            countryId: finalCountryId 
          }, '❌ SMS-MAN purchase failed, falling back to OnlineSim');
          await saveLog(session.id, 'error', `❌ SMS-MAN a échoué : ${error.message}`, 'provision');
          await saveLog(session.id, 'warn', `⚠️ Basculement vers OnlineSim...`, 'provision');
          
          // Fallback to OnlineSim
          try {
            logger.info({ fallbackReason: error.message }, '🔄 Starting OnlineSim fallback...');
            await saveLog(session.id, 'info', `🔄 Tentative avec OnlineSim en secours...`, 'provision');
            
            const targetCountry = countryNameForOnlineSim || 'United States';
            logger.info({ targetCountry }, 'Looking up OnlineSim country ID...');
            
            const onlineSimCountryId = countryNameForOnlineSim 
              ? await onlineSimAdapter.getCountryId(countryNameForOnlineSim)
              : await onlineSimAdapter.getCountryId('United States'); // Default to US
            
            logger.info({ onlineSimCountryId, targetCountry }, 'OnlineSim country ID resolved');
            await saveLog(session.id, 'info', `📍 OnlineSim country: ${targetCountry} (ID: ${onlineSimCountryId})`, 'provision');
            
            let serviceId: string;
            try {
              logger.info({ onlineSimCountryId }, 'Getting WhatsApp service ID from OnlineSim...');
                  serviceId = await onlineSimAdapter.getWhatsAppServiceId(onlineSimCountryId);
              logger.info({ serviceId, onlineSimCountryId }, 'WhatsApp service ID resolved');
            } catch (getServiceIdError: any) {
              const isTryAgain = getServiceIdError.message?.includes('TRY_AGAIN_LATER');
                  if (isTryAgain) {
                logger.error({ error: getServiceIdError.message }, 'OnlineSim returned TRY_AGAIN_LATER (rate-limited or no numbers)');
                await saveLog(session.id, 'error', `❌ OnlineSim: ${getServiceIdError.message}`, 'provision');
                const detailedError = `SMS-MAN: ${error.message} | OnlineSim: ${getServiceIdError.message}`;
                    throw new Error(`All providers exhausted. ${detailedError}`);
                  }
              logger.error({ error: getServiceIdError.message }, 'Failed to get OnlineSim service ID');
              await saveLog(session.id, 'error', `❌ OnlineSim service lookup failed: ${getServiceIdError.message}`, 'provision');
              throw getServiceIdError;
            }
            
            logger.info({ onlineSimCountryId, serviceId }, 'Purchasing number from OnlineSim...');
            await saveLog(session.id, 'info', `📞 Purchasing from OnlineSim...`, 'provision');
            
            const onlineSimResult = await onlineSimAdapter.buyNumber(onlineSimCountryId, serviceId);
            
            buyResult = {
              request_id: onlineSimResult.tzid.toString(),
              number: onlineSimResult.number,
            };
            
            // Update provider to OnlineSim since we're using it
            provider = 'ONLINESIM';
            
            try {
              phoneNumberId = await phoneNumberService.savePhoneNumber({
                phone: buyResult.number,
                requestId: buyResult.request_id,
                provider: 'ONLINESIM',
                countryId: onlineSimCountryId.toString(),
              });
            } catch (saveError: any) {
              // Ignore duplicate errors
            }
            
            logger.info({ provider: 'ONLINESIM', number: buyResult.number, tzid: buyResult.request_id }, '✅ Successfully purchased number from OnlineSim fallback');
            await saveLog(session.id, 'info', `✅ Secours OnlineSim réussi : ${buyResult.number}`, 'provision');
          } catch (onlineSimError: any) {
            logger.error({ 
              smsManError: error.message, 
              onlineSimError: onlineSimError.message,
              onlineSimErrorStack: onlineSimError.stack
            }, '❌ All number providers exhausted');
            await saveLog(session.id, 'error', `❌ Tous les fournisseurs de numéros épuisés`, 'provision');
            await saveLog(session.id, 'error', `  ├─ SMS-MAN : ${error.message}`, 'provision');
            await saveLog(session.id, 'error', `  └─ OnlineSim : ${onlineSimError.message}`, 'provision');
            throw new Error(`No numbers available from any provider. SMS-MAN: ${error.message} | OnlineSim: ${onlineSimError.message}`);
          }
        }
      }
      
      // Verify buyResult is not null before proceeding
      if (!buyResult || !buyResult.request_id || !buyResult.number) {
        logger.error({ buyResult }, 'buyResult is null or incomplete after purchase attempt');
        throw new Error('Failed to purchase number - buyResult is null or incomplete');
      }
      
      // Mark number as used
      if (phoneNumberId) {
        try {
          await phoneNumberService.markAsUsed(phoneNumberId, provisionId);
        } catch (markError: any) {
          logger.warn({ error: markError.message }, 'Failed to mark number as used');
        }
      }

      logger.info({ 
        provisionId, 
        requestId: buyResult.request_id, 
        phone: buyResult.number 
      }, 'Number purchased successfully!');
      
      // Update provision with phone number
      if (provider === 'SMS-MAN' || !countryNameForOnlineSim) {
        await provisionService.updateProvisionNumber(
          provisionId,
          buyResult.request_id,
          buyResult.number
        );
      } else {
        await prisma.provision.update({
          where: { id: provisionId },
          data: { phone: buyResult.number },
        });
      }
      
      // Ensure number has + prefix for WhatsApp
      if (!buyResult.number.startsWith('+')) {
        buyResult.number = `+${buyResult.number}`;
        logger.info({ formattedNumber: buyResult.number }, 'Added + prefix to phone number');
      }
      
      // Broadcast number purchase
      const countryInfo = countryNameForOnlineSim ? ` (Country: ${countryNameForOnlineSim})` : '';
      await saveLog(session.id, 'info', `✅ Number purchased: ${buyResult.number}${countryInfo}`, 'provision');
      await broadcastEvent('provision_update', {
        provisionId,
        sessionId: session.id,
        state: ProvisionState.BUYING_NUMBER,
        progress: 55,
        message: `✅ Number purchased: ${buyResult.number}${countryInfo}`
      });
      
      return buyResult;
    };
    
    await job.updateProgress(45);
    
    // Step 4: Start WhatsApp automation with buy callback
    await provisionService.updateProvisionState(provisionId, ProvisionState.LAUNCHING_WHATSAPP);
    await saveLog(session.id, 'info', '🚀 Starting WhatsApp automation...', 'automation');
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.LAUNCHING_WHATSAPP,
      progress: 50,
      message: '🚀 Launching WhatsApp...'
    });
    
    try {
      await whatsappAutomationService.automateRegistration({
        appiumPort: session.appiumPort!,
        phoneNumber: undefined, // Will be provided by buyNumberCallback
        sessionId: session.id,
        containerId: session.containerId || undefined,
        vncPort: session.vncPort || undefined, // VNC port for clicking via VNC (bypasses anti-bot)
        countryName: countryNameForOnlineSim || undefined,
        buyNumberCallback, // Pass the callback!
        onLog: async (msg: string) => {
          await saveLog(session.id, 'info', msg, 'automation');
        },
        onStateChange: async (state: string, progress: number, message: string) => {
          await saveLog(session.id, 'info', `${message}`, 'automation');
          await broadcastEvent('provision_update', {
            provisionId,
            sessionId: session.id,
            state: state as any,
            progress,
            message
          });
        },
      });
      await saveLog(session.id, 'info', '✅ Phone number submitted to WhatsApp. Now waiting for SMS code...', 'automation');
      await broadcastEvent('provision_update', {
        provisionId,
        state: ProvisionState.WAITING_OTP,
        progress: 60,
        message: '💬 Phone number submitted, waiting for SMS code...'
      });
    } catch (error: any) {
          logger.warn({ error: error.message, provisionId }, 'WhatsApp automation failed, continuing with SMS polling');
          await saveLog(session.id, 'warn', `WhatsApp automation failed: ${error.message}. The system will still wait for SMS.`, 'automation', { error: error.message });
          await broadcastEvent('provision_update', {
            provisionId,
            state: ProvisionState.WAITING_OTP,
            progress: 55,
            message: `⚠️ Automation incomplete: ${error.message}. Waiting for SMS...`
          });
    }
    
    await job.updateProgress(65);
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.WAITING_OTP,
      progress: 65,
      message: '⏳ Waiting for SMS code to arrive...'
    });
    
    // CRITICAL: Verify that a number was actually purchased
    if (!buyResult || !buyResult.request_id || !buyResult.number) {
      const errorMsg = 'Number purchase failed - no number available. Cannot proceed with provisioning.';
      logger.error({ provisionId, buyResult, provider }, errorMsg);
      await saveLog(session.id, 'error', `❌ ${errorMsg}`, 'provision');
      await broadcastEvent('provision_update', {
        provisionId,
        sessionId: session.id,
        state: ProvisionState.FAILED,
        progress: 0,
        message: `❌ ${errorMsg}`
      });
      throw new Error(errorMsg);
    }
    
    // Step 5: Poll for OTP from the provider used (with 60s timeout and retry logic)
    logger.info({ provisionId, requestId: buyResult.request_id, provider, phone: buyResult.number }, 'Polling for OTP');
    
    let otp: string | undefined;
    let pollingAttempt = 0;
    const maxPollingAttempts = 3; // Max 3 attempts (60s each = 180s total)
    
    while (pollingAttempt < maxPollingAttempts) {
      try {
        // Poll with 60 second timeout
        const pollStartTime = Date.now();
        const sixtySeconds = 60000;
        
        if (provider === 'ONLINESIM') {
          const tzid = Number(buyResult.request_id);
          let smsReceived = false;
          
          while (Date.now() - pollStartTime < sixtySeconds && !smsReceived) {
            try {
              logger.info({ tzid, elapsed: Date.now() - pollStartTime }, 'Polling OnlineSim for SMS...');
              const sms = await onlineSimAdapter.getSms(tzid);
              logger.info({ tzid, sms, hasContent: !!sms }, 'OnlineSim API response');
              if (sms && sms.trim().length > 0) {
                otp = sms;
                smsReceived = true;
                logger.info({ tzid, otp }, 'SMS received from OnlineSim');
                break;
              }
            } catch (error: any) {
              logger.warn({ tzid, error: error.message, code: error.code }, 'OnlineSim polling error');
              if (error.code === 'ERROR_NO_OPERATIONS' || error.message === 'TZID_NO_LONGER_VALID') {
                throw error;
              }
            }
            await new Promise(resolve => setTimeout(resolve, 3000)); // Check every 3 seconds
          }
          
          if (!smsReceived) {
            throw new Error('SMS_TIMEOUT_60S');
          }
        } else {
          // SMS-MAN: similar approach with 60s timeout
          const requestId = buyResult.request_id;
          let smsReceived = false;
          
          while (Date.now() - pollStartTime < sixtySeconds && !smsReceived) {
            try {
              logger.info({ requestId, elapsed: Date.now() - pollStartTime }, 'Polling SMS-MAN for SMS...');
              const result = await smsManAdapter.getSms(requestId);
              logger.info({ requestId, result, hasSmsCode: !!result.sms_code }, 'SMS-MAN API response');
              if (result.sms_code) {
                otp = result.sms_code;
                smsReceived = true;
                logger.info({ requestId, otp }, 'SMS received from SMS-MAN');
                break;
              }
            } catch (error: any) {
              logger.warn({ requestId, error: error.message }, 'SMS-MAN polling error');
              
              // Check if it's a critical error that should trigger fallback
              const isCriticalError = error.message?.includes('not exists') || 
                                     error.message?.includes('ERROR_NO_OPERATIONS') ||
                                     error.message?.includes('INVALID_REQUEST') ||
                                     error.code === 'ERROR_NO_OPERATIONS';
              
              if (isCriticalError) {
                logger.error({ requestId, error: error.message }, 'SMS-MAN request failed - number may be invalid');
                throw error; // Throw to exit polling loop
              }
              
              // For other errors, continue polling (might be temporary API issue)
              logger.warn({ requestId }, 'SMS-MAN temporary error, continuing to poll...');
            }
            await new Promise(resolve => setTimeout(resolve, 3000)); // Check every 3 seconds
          }
          
          if (!smsReceived) {
            throw new Error('SMS_TIMEOUT_60S');
          }
        }
        
        logger.info({ provisionId, otp, fullSms: otp }, 'OTP received');
        break; // Exit retry loop on success
        
      } catch (pollError: any) {
        pollingAttempt++;
        const isTimeout = pollError.message === 'SMS_TIMEOUT_60S' || pollError.message.includes('timeout');
        const isInvalidTzid = pollError.code === 'ERROR_NO_OPERATIONS' || 
                              pollError.message === 'TZID_NO_LONGER_VALID' || 
                              (pollError.message && pollError.message.includes('ERROR_NO_OPERATIONS'));
        
        // If timeout after 60s or invalid TZID, just log and retry (NO new container)
        if ((isTimeout || isInvalidTzid) && pollingAttempt < maxPollingAttempts) {
          await saveLog(session.id, 'warn', `No SMS received after 60s, retrying (attempt ${pollingAttempt}/${maxPollingAttempts})...`, 'sms');
          await broadcastEvent('provision_update', {
            provisionId,
            sessionId: session.id,
            state: ProvisionState.WAITING_OTP,
            progress: 60 + (pollingAttempt * 5),
            message: `⏳ Still waiting for SMS (attempt ${pollingAttempt}/${maxPollingAttempts})...`
          });
          continue; // Just retry polling, don't create new container
        } else {
          // Not a timeout or invalid TZID, or max attempts reached - throw error
          throw pollError;
        }
      }
    }
    
    // If we exit the loop without getting OTP, throw error
    if (!otp) {
      throw new Error(`Failed to receive SMS after ${maxPollingAttempts} attempts (60s each)`);
    }
    
    const extractedOtp = extractOtpCode(otp);
    await saveLog(session.id, 'info', `📱 SMS received: ${extractedOtp}`, 'sms');
    
    await broadcastEvent('otp_received', {
      provisionId,
      otp: extractedOtp,
      fullSms: otp,
      message: `📱 SMS received! Code: ${extractedOtp}`
    });
    
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.WAITING_OTP,
      progress: 70,
      message: `📱 SMS received: ${extractedOtp}`
    });

    // Log OTP
    await prisma.otpLog.create({
      data: {
        provisionId,
        rawSms: otp,
        code: extractOtpCode(otp),
      },
    });

    await job.updateProgress(80);

    // Step 6: Enqueue OTP injection job AND WAIT for it to complete
    await provisionService.updateProvisionState(provisionId, ProvisionState.INJECTING_OTP);
    await saveLog(session.id, 'info', `🔑 Injecting SMS code into WhatsApp: ${extractedOtp}...`, 'provision');
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.INJECTING_OTP,
      progress: 80,
      message: `🔑 Entering SMS code: ${extractedOtp}...`
    });

    // Mark SMS as ready (only for SMS-MAN, OnlineSim doesn't need this)
    if (provider === 'SMS-MAN') {
      try {
        await smsManAdapter.setStatus(buyResult.request_id, 'ready');
      } catch (error: any) {
        logger.warn({ error: error.message, requestId: buyResult.request_id }, 'Failed to mark SMS as ready on SMS-MAN');
      }
    }

    const otpJob = await otpQueue.add('process-otp', {
      provisionId,
      requestId: buyResult.request_id,
      otp: extractOtpCode(otp),
    });

    logger.info({ provisionId, otpJobId: otpJob.id }, 'OTP job enqueued, waiting for completion...');
    await saveLog(session.id, 'info', '⏳ Waiting for OTP injection and profile setup to complete...', 'provision');

    // WAIT for the OTP job to finish (includes OTP injection + profile setup + all screens)
    try {
      await otpJob.waitUntilFinished(otpQueueEvents, 300000); // Wait up to 5 minutes (increased from 2)
      logger.info({ provisionId, otpJobId: otpJob.id }, 'OTP job completed successfully');
      await saveLog(session.id, 'info', '✅ OTP injection and profile setup completed!', 'provision');
    } catch (otpError: any) {
      logger.error({ error: otpError.message, provisionId }, 'OTP job failed');
      await saveLog(session.id, 'error', `❌ OTP injection failed: ${otpError.message}`, 'provision');
      throw new Error(`OTP injection failed: ${otpError.message}`);
    }

    // Step: Final setup (after OTP injection is REALLY done)
    await provisionService.updateProvisionState(provisionId, ProvisionState.SETTING_UP);
    await saveLog(session.id, 'info', '⚙️ Finalizing session activation...', 'provision');
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.SETTING_UP,
      progress: 95,
      message: '⚙️ Finalizing session activation...'
    });
    
    // Give system time to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
    await job.updateProgress(100);
    
    await broadcastEvent('session_ready', {
      provisionId,
      sessionId: session.id,
      phone: buyResult.number,
      message: 'WhatsApp session is ready!'
    });

    logger.info({ provisionId, sessionId: session.id }, 'Provision job completed');

    return { 
      success: true, 
      sessionId: session.id,
      phone: buyResult.number,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error({ error: errorMessage, provisionId }, 'Provision job failed');
    
    await provisionService.updateProvisionState(
      provisionId,
      ProvisionState.FAILED,
      errorMessage
    );
    
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.FAILED,
      error: errorMessage,
      message: 'Provision failed'
    });

    throw error;
  }
}

/**
 * Extract OTP code from SMS text
 */
function extractOtpCode(sms: string): string {
  // WhatsApp OTP format: "Your WhatsApp code: XXX-XXX" or just "XXXXXX"
  const patterns = [
    /(\d{3}-\d{3})/,  // XXX-XXX format
    /(\d{6})/,        // XXXXXX format
    /code[:\s]+(\d{3}-?\d{3})/i,
  ];

  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match) {
      return match[1].replace('-', '');
    }
  }

  // Fallback: return the SMS as-is
  return sms;
}

// Create worker
export const provisionWorker = new Worker<ProvisionJobData>(
  'provision',
  processProvision,
  {
    connection,
    concurrency: 1, // REDUCED to 1 to avoid race conditions and prevent duplicate job execution
    limiter: {
      max: 5,
      duration: 60000, // 5 jobs per minute
    },
  }
);

provisionWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, provisionId: job.data.provisionId }, 'Job completed');
});

provisionWorker.on('failed', (job, err) => {
  logger.error({ 
    jobId: job?.id, 
    provisionId: job?.data.provisionId, 
    error: err 
  }, 'Job failed');
});

logger.info('Provision worker started');
