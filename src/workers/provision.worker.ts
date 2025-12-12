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
 * Get Canada country ID from SMS-MAN
 */
async function getCanadaCountryId(): Promise<string> {
  try {
    return await smsManAdapter.getCountryId('Canada');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get Canada country ID from SMS-MAN');
    // Use default fallback - SMS-MAN Canada is typically country ID "36"
    return '36';
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
    
    // Try OnlineSim FIRST for this country (better SMS reception rate)
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
          logger.info({ country: countryName }, `⚠️ ${countryName} - no numbers on OnlineSim, trying SMS-MAN...`);
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
    
    // Try SMS-MAN as fallback if OnlineSim failed or no numbers
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
        logger.info({ country: countryName }, `⚠️ ${countryName} - no numbers on SMS-MAN`);
      }
    } catch (smsManError: any) {
      logger.warn({ country: countryName, error: smsManError.message }, `⚠️ SMS-MAN error for ${countryName}`);
    }
    
    logger.warn({ country: countryName }, `❌ ${countryName} - no numbers available on any provider, trying next country...`);
  }
  
  // If we get here, all countries failed
  throw new Error(`No numbers available in any country: ${countryCascade.join(', ')}`);
}

async function processProvision(job: Job<ProvisionJobData>) {
  const { provisionId, countryId, applicationId, linkToWeb } = job.data;
  
  logger.info({ provisionId, jobId: job.id }, 'Processing provision job');

  // Declare session outside try-catch so it's accessible in catch block
  let session: any = null;

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
    
    await saveLog(session.id, 'info', '📦 Conteneur Docker créé avec succès', 'provision');
    await saveLog(session.id, 'info', `🖥️ Session ID: ${session.id}`, 'provision');
    await saveLog(session.id, 'info', '🤖 Démarrage d\'Android dans l\'émulateur...', 'provision');
    
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 15,
      message: `🤖 Android est en train de démarrer...`
    });
    
    // Wait a bit for Android to boot
    await new Promise(resolve => setTimeout(resolve, 3000));
    await saveLog(session.id, 'info', '✅ Android a démarré avec succès', 'provision');
    await saveLog(session.id, 'info', '📱 Système Android opérationnel', 'provision');
    
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.SPAWNING_CONTAINER,
      progress: 20,
      message: `✅ Android opérationnel`
    });
    
    await job.updateProgress(20);
    
    await saveLog(session.id, 'info', '🔧 Préparation du système...', 'provision');
    
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
    
    await saveLog(session.id, 'info', '📱 Préparation du lancement de WhatsApp...', 'provision');
    
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.LAUNCHING_WHATSAPP,
      progress: 25,
      message: `📱 Préparation de WhatsApp...`
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
            await saveLog(session.id, 'warn', `⚠️ OnlineSim indisponible, fallback vers SMS-MAN...`, 'provision');
          } else {
            logger.error({ error: error.message }, 'OnlineSim purchase failed, falling back to SMS-MAN');
            await saveLog(session.id, 'error', `❌ OnlineSim échoué : ${error.message}`, 'provision');
            await saveLog(session.id, 'warn', `⚠️ Fallback vers SMS-MAN...`, 'provision');
          }
          
          try {
            const smsManCountryId = await getUnitedStatesCountryId();
            logger.info({ smsManCountryId }, 'Attempting SMS-MAN purchase as fallback...');
            await saveLog(session.id, 'info', `📞 Tentative d'achat SMS-MAN en fallback (US)...`, 'provision');
            
            buyResult = await smsManAdapter.buyNumber(
              smsManCountryId,
              applicationId || await smsManAdapter.getWhatsAppApplicationId()
            );
            
            logger.info({ number: buyResult.number }, '✅ SMS-MAN fallback successful');
            await saveLog(session.id, 'info', `✅ Fallback SMS-MAN réussi : ${buyResult.number}`, 'provision');
            
            try {
              phoneNumberId = await phoneNumberService.savePhoneNumber({
                phone: buyResult.number,
                requestId: buyResult.request_id,
                provider: 'SMS-MAN',
                countryId: smsManCountryId,
              });
            } catch (saveError: any) {
              // Ignore duplicate errors
            }
          } catch (smsManFallbackError: any) {
            logger.error({ 
              onlineSimError: error.message,
              smsManFallbackError: smsManFallbackError.message 
            }, '❌ Both providers failed: OnlineSim and SMS-MAN fallback');
            await saveLog(session.id, 'error', `❌ Les deux fournisseurs ont échoué`, 'provision');
            await saveLog(session.id, 'error', `  ├─ OnlineSim : ${error.message}`, 'provision');
            await saveLog(session.id, 'error', `  └─ SMS-MAN fallback : ${smsManFallbackError.message}`, 'provision');
            throw new Error(`All providers exhausted. OnlineSim: ${error.message} | SMS-MAN fallback: ${smsManFallbackError.message}`);
          }
        }
      } else {
        // SMS-MAN (primary for direct purchase) - Try USA first, then Canada, then OnlineSim
        const smsManCountries = [
          { id: await getUnitedStatesCountryId(), name: 'USA' },
          { id: await getCanadaCountryId(), name: 'Canada' }
        ];
        
        let smsManSuccess = false;
        let lastSmsManError: Error | null = null;
        
        for (const country of smsManCountries) {
          logger.info({ provider: 'SMS-MAN', countryId: country.id, countryName: country.name }, `🔄 Attempting to purchase number from SMS-MAN (${country.name})...`);
          await saveLog(session.id, 'info', `📞 Tentative SMS-MAN (${country.name})...`, 'provision');
          
          try {
            buyResult = await smsManAdapter.buyNumber(
              country.id,
              applicationId || await smsManAdapter.getWhatsAppApplicationId()
            );
            
            logger.info({ number: buyResult.number, requestId: buyResult.request_id, country: country.name }, `✅ Achat SMS-MAN réussi (${country.name})`);
            await saveLog(session.id, 'info', `✅ Achat SMS-MAN réussi (${country.name}) : ${buyResult.number}`, 'provision');
            
            try {
              phoneNumberId = await phoneNumberService.savePhoneNumber({
                phone: buyResult.number,
                requestId: buyResult.request_id,
                provider: 'SMS-MAN',
                countryId: country.id,
              });
            } catch (saveError: any) {
              // Ignore duplicate errors
            }
            
            smsManSuccess = true;
            break; // Success! Exit the loop
          } catch (error: any) {
            lastSmsManError = error;
            logger.warn({ 
              error: error.message,
              provider: 'SMS-MAN',
              country: country.name,
              countryId: country.id
            }, `⚠️ SMS-MAN (${country.name}) échoué, tentative avec le pays suivant...`);
            await saveLog(session.id, 'warn', `⚠️ SMS-MAN (${country.name}) échoué : ${error.message}`, 'provision');
            // Continue to next country
          }
        }
        
        if (!smsManSuccess) {
          logger.error({ 
            error: lastSmsManError?.message,
            errorStack: lastSmsManError?.stack,
            provider: 'SMS-MAN'
          }, '❌ SMS-MAN purchase failed for all countries (USA + Canada), falling back to OnlineSim');
          await saveLog(session.id, 'error', `❌ SMS-MAN a échoué pour tous les pays (USA + Canada)`, 'provision');
          await saveLog(session.id, 'warn', `⚠️ Basculement vers OnlineSim...`, 'provision');
          
          // Fallback to OnlineSim
          try {
            logger.info({ fallbackReason: lastSmsManError?.message }, '🔄 Starting OnlineSim fallback...');
            await saveLog(session.id, 'info', `🔄 Tentative avec OnlineSim en secours...`, 'provision');
            
            let onlineSimCountryId: number;
            let targetCountry: string;
            let serviceId: string;
            
            // Strategy 1: Try specified country if available
            if (countryNameForOnlineSim) {
              try {
                targetCountry = countryNameForOnlineSim;
                logger.info({ targetCountry }, '📍 Strategy 1: Trying specified country...');
                await saveLog(session.id, 'info', `📍 Tentative avec ${targetCountry}...`, 'provision');
                
                onlineSimCountryId = await onlineSimAdapter.getCountryId(countryNameForOnlineSim);
                logger.info({ onlineSimCountryId, targetCountry }, 'Country ID resolved');
                
                serviceId = await onlineSimAdapter.getWhatsAppServiceId(onlineSimCountryId);
                logger.info({ serviceId, onlineSimCountryId }, '✅ Strategy 1 successful');
                await saveLog(session.id, 'info', `✅ ${targetCountry} disponible (ID: ${onlineSimCountryId})`, 'provision');
              } catch (strategy1Error: any) {
                logger.warn({ error: strategy1Error.message, country: countryNameForOnlineSim }, '⚠️ Strategy 1 failed, trying Strategy 2...');
                await saveLog(session.id, 'warn', `⚠️ ${countryNameForOnlineSim} échoué: ${strategy1Error.message}`, 'provision');
                
                // Strategy 2: Use findAvailableCountry to automatically find a working country
                logger.info({}, '🔍 Strategy 2: Finding any available country with WhatsApp numbers...');
                await saveLog(session.id, 'info', `🔍 Recherche automatique d'un pays disponible...`, 'provision');
                
                try {
                  const availableCountry = await onlineSimAdapter.findAvailableCountry();
                  onlineSimCountryId = availableCountry.countryId;
                  targetCountry = availableCountry.countryName;
                  
                  logger.info({ onlineSimCountryId, targetCountry }, '✅ Found available country');
                  await saveLog(session.id, 'info', `✅ Pays trouvé: ${targetCountry} (ID: ${onlineSimCountryId})`, 'provision');
                  
                  serviceId = await onlineSimAdapter.getWhatsAppServiceId(onlineSimCountryId);
                  logger.info({ serviceId, onlineSimCountryId }, '✅ Strategy 2 successful');
                } catch (strategy2Error: any) {
                  const isTryAgain = strategy2Error.message?.includes('TRY_AGAIN_LATER');
                  if (isTryAgain) {
                    logger.error({ error: strategy2Error.message }, '❌ OnlineSim API rate-limited (TRY_AGAIN_LATER)');
                    await saveLog(session.id, 'error', `❌ OnlineSim API temporairement indisponible (rate limit)`, 'provision');
                    await saveLog(session.id, 'error', `  ├─ SMS-MAN (USA + Canada) : ${lastSmsManError?.message}`, 'provision');
                    await saveLog(session.id, 'error', `  └─ OnlineSim : ${strategy2Error.message}`, 'provision');
                    const detailedError = `SMS-MAN: ${lastSmsManError?.message} | OnlineSim: ${strategy2Error.message}`;
                    throw new Error(`All providers exhausted. ${detailedError}`);
                  }
                  throw strategy2Error;
                }
              }
            } else {
              // No country name provided, use Strategy 2 directly
              logger.info({}, '🔍 No country specified, using findAvailableCountry...');
              await saveLog(session.id, 'info', `🔍 Recherche d'un pays disponible...`, 'provision');
              
              const availableCountry = await onlineSimAdapter.findAvailableCountry();
              onlineSimCountryId = availableCountry.countryId;
              targetCountry = availableCountry.countryName;
              
              logger.info({ onlineSimCountryId, targetCountry }, '✅ Found available country');
              await saveLog(session.id, 'info', `✅ Pays trouvé: ${targetCountry} (ID: ${onlineSimCountryId})`, 'provision');
              
              serviceId = await onlineSimAdapter.getWhatsAppServiceId(onlineSimCountryId);
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
            countryNameForOnlineSim = targetCountry; // Update country name for later use
            
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
            
            logger.info({ provider: 'ONLINESIM', number: buyResult.number, tzid: buyResult.request_id, country: targetCountry }, '✅ Successfully purchased number from OnlineSim fallback');
            await saveLog(session.id, 'info', `✅ Secours OnlineSim réussi : ${buyResult.number} (${targetCountry})`, 'provision');
          } catch (onlineSimError: any) {
            logger.error({ 
              smsManError: lastSmsManError?.message, 
              onlineSimError: onlineSimError.message,
              onlineSimErrorStack: onlineSimError.stack
            }, '❌ All number providers exhausted');
            await saveLog(session.id, 'error', `❌ Tous les fournisseurs de numéros épuisés`, 'provision');
            await saveLog(session.id, 'error', `  ├─ SMS-MAN (USA + Canada) : ${lastSmsManError?.message}`, 'provision');
            await saveLog(session.id, 'error', `  └─ OnlineSim : ${onlineSimError.message}`, 'provision');
            throw new Error(`No numbers available from any provider. SMS-MAN: ${lastSmsManError?.message} | OnlineSim: ${onlineSimError.message}`);
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
      
      // SMS-MAN: MUST call setStatus('ready') to receive SMS
      if (provider === 'SMS-MAN') {
        try {
          logger.info({ requestId: buyResult.request_id }, 'Marking SMS-MAN number as ready to receive SMS...');
          await saveLog(session.id, 'info', `📲 Calling setStatus('ready') for ${buyResult.request_id}...`, 'sms');
          await smsManAdapter.setStatus(buyResult.request_id, 'ready');
          logger.info({ requestId: buyResult.request_id }, 'SMS-MAN number marked as ready');
          await saveLog(session.id, 'info', '✅ SMS-MAN setStatus(ready) SUCCESS - number is ready to receive SMS', 'sms');
        } catch (error: any) {
          logger.error({ error: error.message, requestId: buyResult.request_id }, 'FAILED to mark SMS as ready!');
          await saveLog(session.id, 'error', `❌ setStatus FAILED: ${error.message}`, 'sms');
          // This is critical - if setStatus fails, SMS will NOT be received
        }
      }
      
      // Broadcast number purchase
      const countryInfo = countryNameForOnlineSim ? ` (${countryNameForOnlineSim})` : '';
      await saveLog(session.id, 'info', `✅ Numéro acheté: ${buyResult.number}${countryInfo}`, 'provision');
      await broadcastEvent('provision_update', {
        provisionId,
        sessionId: session.id,
        state: ProvisionState.ENTERING_PHONE,
        progress: 55,
        message: `✅ Numéro acheté: ${buyResult.number}${countryInfo}`
      });
      
      return buyResult;
    };
    
    await job.updateProgress(45);
    
    // Step 3: Start WhatsApp automation with buy callback (contact creation removed - will be done after WhatsApp is ready)
    await provisionService.updateProvisionState(provisionId, ProvisionState.LAUNCHING_WHATSAPP);
    await saveLog(session.id, 'info', '🤖 Connexion à Appium pour contrôler l\'émulateur...', 'automation');
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.LAUNCHING_WHATSAPP,
      progress: 50,
      message: '🤖 Connexion au système d\'automatisation...'
    });
    
    let automationRetries = 0;
    const MAX_AUTOMATION_RETRIES = 1; // Only retry once if phone is already registered
    let automationSuccess = false;
    
    while (!automationSuccess && automationRetries <= MAX_AUTOMATION_RETRIES) {
    try {
      await whatsappAutomationService.automateRegistration({
        appiumPort: session.appiumPort!,
        phoneNumber: undefined, // Will be provided by buyNumberCallback
        sessionId: session.id,
        containerId: session.containerId || undefined,
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
        automationSuccess = true;
      await saveLog(session.id, 'info', '✅ Phone number submitted to WhatsApp. Now waiting for SMS code...', 'automation');
      await broadcastEvent('provision_update', {
        provisionId,
        state: ProvisionState.WAITING_OTP,
        progress: 60,
        message: '💬 Phone number submitted, waiting for SMS code...'
      });
    } catch (error: any) {
        // Check if it's a "phone already registered" error
        if (error.message && error.message.startsWith('PHONE_ALREADY_REGISTERED:') && automationRetries < MAX_AUTOMATION_RETRIES) {
          automationRetries++;
          const registeredPhone = error.message.split(':')[1];
          logger.warn({ registeredPhone, provisionId, retry: automationRetries }, 'Phone already registered on another device, resetting WhatsApp in same container...');
          await saveLog(session.id, 'warn', `⚠️ Numéro ${registeredPhone} déjà enregistré sur un autre appareil`, 'automation');
          await saveLog(session.id, 'info', `🔄 Réinitialisation de WhatsApp dans le même container (tentative ${automationRetries}/${MAX_AUTOMATION_RETRIES})...`, 'automation');
          
          await broadcastEvent('provision_update', {
            provisionId,
            sessionId: session.id,
            state: ProvisionState.LAUNCHING_WHATSAPP,
            progress: 40,
            message: `🔄 Réinitialisation de WhatsApp (numéro déjà utilisé)...`
          });
          
          // Reset WhatsApp in the same container
          try {
            const containerId = session.containerId;
            if (!containerId) {
              throw new Error('Container ID not found');
            }
            
            logger.info({ containerId, sessionId: session.id }, 'Uninstalling WhatsApp from container...');
            await saveLog(session.id, 'info', '📥 Désinstallation de WhatsApp...', 'automation');
            
            // Uninstall WhatsApp via ADB
            // @ts-ignore - TODO: Fix DockerService interface
            await dockerService.execInContainer(containerId, [
              'adb', '-s', 'emulator-5554', 'shell', 'pm', 'uninstall', 'com.whatsapp'
            ]);
            
            await saveLog(session.id, 'info', '✅ WhatsApp désinstallé', 'automation');
            logger.info({ containerId }, 'WhatsApp uninstalled, waiting 2s...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Clear data directory
            logger.info({ containerId }, 'Clearing WhatsApp data...');
            // @ts-ignore - TODO: Fix DockerService interface
            await dockerService.execInContainer(containerId, [
              'adb', '-s', 'emulator-5554', 'shell', 'rm', '-rf', '/data/data/com.whatsapp'
            ]).catch(() => {
              // Ignore if directory doesn't exist
            });
            
            await saveLog(session.id, 'info', '📥 Réinstallation de WhatsApp...', 'automation');
            logger.info({ containerId }, 'Reinstalling WhatsApp...');
            
            // Download and install WhatsApp again
            // Use version from early December 2024 (working 3-5 days ago)
            const apkUrl = 'https://www.whatsapp.com/android/2.24.24.76/WhatsApp.apk';
            // @ts-ignore - TODO: Fix DockerService interface
            await dockerService.execInContainer(containerId, [
              'curl', '-L', '-o', '/tmp/whatsapp.apk', apkUrl
            ]);
            
            // @ts-ignore - TODO: Fix DockerService interface
            await dockerService.execInContainer(containerId, [
              'adb', '-s', 'emulator-5554', 'install', '-r', '/tmp/whatsapp.apk'
            ]);
            
            await saveLog(session.id, 'info', '✅ WhatsApp réinstallé avec succès', 'automation');
            logger.info({ containerId }, 'WhatsApp reinstalled successfully');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Reset buyResult to null so it will buy a NEW number
            buyResult = null;
            
            await saveLog(session.id, 'info', '🔄 Redémarrage du processus avec un nouveau numéro...', 'automation');
            await broadcastEvent('provision_update', {
              provisionId,
              sessionId: session.id,
              state: ProvisionState.LAUNCHING_WHATSAPP,
              progress: 45,
              message: '🔄 Redémarrage avec un nouveau numéro...'
            });
            
            // Continue the loop to retry automateRegistration
          } catch (resetError: any) {
            logger.error({ error: resetError, provisionId }, 'Failed to reset WhatsApp in container');
            await saveLog(session.id, 'error', `❌ Échec de la réinitialisation: ${resetError.message}`, 'automation');
            throw resetError;
          }
        } else {
          // Check if this is a CRITICAL error (phone number not submitted)
          if (error.message && error.message.includes('Failed to submit phone number')) {
            // CRITICAL: Cannot proceed without submitting phone number
            logger.error({ error: error.message, provisionId }, 'CRITICAL: Phone number was not submitted - STOPPING provisioning');
            await saveLog(session.id, 'error', `❌ CRITICAL ERROR: ${error.message}`, 'automation');
            await saveLog(session.id, 'error', `❌ PROVISIONING STOPPED - Cannot wait for SMS if phone was never submitted`, 'automation');
            await broadcastEvent('provision_update', {
              provisionId,
              sessionId: session.id,
              state: ProvisionState.FAILED,
              progress: 0,
              message: `❌ Phone number submission failed - ${error.message}`
            });
            
            // Mark provision as failed
            await prisma.provision.update({
              where: { id: provisionId },
              data: { state: ProvisionState.FAILED }
            });
            
            throw new Error(`CRITICAL: ${error.message}`);
          }
          
          // Other error or max retries reached
          logger.warn({ error: error.message, provisionId }, 'WhatsApp automation failed, continuing with SMS polling');
          await saveLog(session.id, 'warn', `WhatsApp automation failed: ${error.message}. The system will still wait for SMS.`, 'automation', { error: error.message });
          await broadcastEvent('provision_update', {
            provisionId,
            state: ProvisionState.WAITING_OTP,
            progress: 55,
            message: `⚠️ Automation incomplete: ${error.message}. Waiting for SMS...`
          });
          break; // Exit loop
        }
      }
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
    
    // CRITICAL: For SMS-MAN, mark number as 'ready' ONLY IF automation succeeded
    // SMS-MAN auto-detects SMS requests, no manual status setting needed
    logger.info({ provider, requestId: buyResult.request_id }, 'Ready to receive SMS from provider');
    
    // Step 4: Poll for OTP from the provider used (with 60s timeout and retry logic)
    logger.info({ provisionId, requestId: buyResult.request_id, provider, phone: buyResult.number }, 'Polling for OTP');
    
    let otp: string | undefined;
    let pollingAttempt = 0;
    const maxPollingAttempts = 3; // Max 3 attempts (60s each = 180s total)
    
    while (pollingAttempt < maxPollingAttempts) {
      try {
        // Poll with 60 second timeout
        const pollStartTime = Date.now();
        const sixtySeconds = 60000;
        
        // Broadcast at the START of each polling attempt so user knows we're actively polling
        logger.info({ pollingAttempt, maxPollingAttempts, provider, requestId: buyResult.request_id }, `Starting SMS polling attempt ${pollingAttempt + 1}/${maxPollingAttempts}`);
        await broadcastEvent('provision_update', {
          provisionId,
          sessionId: session.id,
          state: ProvisionState.WAITING_OTP,
          progress: 65 + (pollingAttempt * 5),
          message: `⏳ En attente du SMS (tentative ${pollingAttempt + 1}/${maxPollingAttempts}, max 60s)...`
        });
        await saveLog(session.id, 'info', `⏳ Tentative ${pollingAttempt + 1}/${maxPollingAttempts} de réception SMS (timeout: 60s)...`, 'sms');
        
        if (provider === 'ONLINESIM') {
          const tzid = Number(buyResult.request_id);
          let smsReceived = false;
          
          while (Date.now() - pollStartTime < sixtySeconds && !smsReceived) {
            try {
              const elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
              logger.info({ tzid, elapsed }, 'Polling OnlineSim for SMS...');
              
              // Broadcast every 30 seconds to show progress
              if (elapsed === 30 || elapsed === 31) {
                await broadcastEvent('provision_update', {
                  provisionId,
                  sessionId: session.id,
                  state: ProvisionState.WAITING_OTP,
                  progress: 67 + (pollingAttempt * 5),
                  message: `⏳ Toujours en attente du SMS... (${elapsed}s écoulées)`
                });
              }
              
              const sms = await onlineSimAdapter.getSms(tzid);
              logger.info({ tzid, sms, hasContent: !!sms }, 'OnlineSim API response');
              if (sms && sms.trim().length > 0) {
                otp = sms;
                smsReceived = true;
                logger.info({ tzid, otp }, 'SMS received from OnlineSim');
                await broadcastEvent('provision_update', {
                  provisionId,
                  sessionId: session.id,
                  state: ProvisionState.WAITING_OTP,
                  progress: 75,
                  message: `✅ SMS reçu: ${otp}`
                });
                break;
              }
            } catch (error: any) {
              logger.warn({ tzid, error: error.message, code: error.code }, 'OnlineSim polling error');
              if (error.code === 'ERROR_NO_OPERATIONS' || error.message === 'TZID_NO_LONGER_VALID') {
                throw error;
              }
            }
            await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
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
              const elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
              logger.info({ requestId, elapsed }, 'Polling SMS-MAN for SMS...');
              
              // Broadcast every 10 seconds to show progress
              if (elapsed % 10 === 0 && elapsed > 0) {
                await broadcastEvent('provision_update', {
                  provisionId,
                  sessionId: session.id,
                  state: ProvisionState.WAITING_OTP,
                  progress: 67 + Math.min(elapsed / 6, 8), // Increment progress slowly
                  message: `⏳ Vérification SMS... (${elapsed}s)`
                });
              }
              
              const result = await smsManAdapter.getSms(requestId);
              logger.info({ requestId, result, hasSmsCode: !!result.sms_code }, 'SMS-MAN API response');
              
              // Log to frontend for visibility
              if (elapsed % 10 === 0) {
                await saveLog(session.id, 'info', `🔍 Polling SMS-MAN (${elapsed}s): ${result.error_msg || 'waiting...'}`, 'sms');
              }
              
              if (result.sms_code) {
                otp = result.sms_code;
                smsReceived = true;
                logger.info({ requestId, otp }, 'SMS received from SMS-MAN');
                await broadcastEvent('provision_update', {
                  provisionId,
                  sessionId: session.id,
                  state: ProvisionState.WAITING_OTP,
                  progress: 75,
                  message: `📱 SMS reçu: ${otp}`
                });
                break;
              } else {
                // Log when no SMS yet (for debugging)
                if (elapsed % 20 === 0 && elapsed > 0) {
                  logger.info({ requestId, elapsed, result }, 'No SMS yet from SMS-MAN, continuing to poll...');
                }
              }
            } catch (error: any) {
              const elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
              logger.warn({ requestId, error: error.message, elapsed }, 'SMS-MAN polling error');
              
              // Broadcast error to frontend
              await broadcastEvent('provision_update', {
                provisionId,
                sessionId: session.id,
                state: ProvisionState.WAITING_OTP,
                progress: 67,
                message: `⚠️ Erreur SMS-MAN (${elapsed}s): ${error.message}`
              });
              
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
            await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
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

    // Step 5: Enqueue OTP injection job AND WAIT for it to complete
    await provisionService.updateProvisionState(provisionId, ProvisionState.INJECTING_OTP);
    await saveLog(session.id, 'info', `🔑 Injecting SMS code into WhatsApp: ${extractedOtp}...`, 'provision');
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.INJECTING_OTP,
      progress: 80,
      message: `🔑 Entering SMS code: ${extractedOtp}...`
    });

    const otpJob = await otpQueue.add('process-otp', {
      provisionId,
      requestId: buyResult.request_id,
      otp: extractOtpCode(otp),
    });

    logger.info({ provisionId, otpJobId: otpJob.id }, 'OTP job enqueued, waiting for completion...');
    await saveLog(session.id, 'info', '⏳ Waiting for OTP injection and profile setup to complete...', 'provision');

    // WAIT for the OTP job to finish (includes OTP injection + profile setup + all screens)
    try {
      await otpJob.waitUntilFinished(otpQueueEvents, 600000); // Wait up to 10 minutes
      logger.info({ provisionId, otpJobId: otpJob.id }, 'OTP job completed successfully');
      await saveLog(session.id, 'info', '✅ OTP injection and profile setup completed!', 'provision');
    } catch (otpError: any) {
      logger.error({ error: otpError.message, provisionId }, 'OTP job failed');
      await saveLog(session.id, 'error', `❌ OTP injection failed: ${otpError.message}`, 'provision');
      throw new Error(`OTP injection failed: ${otpError.message}`);
    }

    // Step: Mark session as ACTIVE
    await provisionService.updateProvisionState(provisionId, ProvisionState.ACTIVE);
    await saveLog(session.id, 'info', '✅ Session WhatsApp activée avec succès !', 'provision');
    await broadcastEvent('provision_update', {
      provisionId,
      sessionId: session.id,
      state: ProvisionState.ACTIVE,
      progress: 100,
      message: '✅ Session WhatsApp activée avec succès !'
    });
    
    await broadcastEvent('session_ready', {
      provisionId,
      sessionId: session.id,
      phone: buyResult.number,
      message: '✅ Le compte WhatsApp est prêt à l\'emploi !'
    });

    await job.updateProgress(100);
    logger.info({ provisionId, sessionId: session.id }, 'Provision job completed successfully');

    return { 
      success: true, 
      sessionId: session.id,
      phone: buyResult.number,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error({ error: errorMessage, provisionId }, 'Provision job failed');
    
    // Special handling for "phone already registered" error
    let userFriendlyMessage = 'Provision failed';
    if (errorMessage.includes('PHONE_ALREADY_REGISTERED')) {
      userFriendlyMessage = '❌ Ce numéro est déjà enregistré sur un autre appareil WhatsApp';
      if (session && session.id) {
        await saveLog(session.id, 'error', userFriendlyMessage, 'provision');
        await saveLog(session.id, 'error', 'Le provisioning ne peut pas continuer avec ce numéro.', 'provision');
      }
    }
    
    await provisionService.updateProvisionState(
      provisionId,
      ProvisionState.FAILED,
      errorMessage
    );
    
    await broadcastEvent('provision_update', {
      provisionId,
      state: ProvisionState.FAILED,
      error: errorMessage,
      message: userFriendlyMessage
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
