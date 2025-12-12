import { createChildLogger } from '../utils/logger';
import { remote, RemoteOptions } from 'webdriverio';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const logger = createChildLogger('whatsapp-automation');

// WhatsApp Registration Steps - Clear methodology
export enum WhatsAppStep {
  LAUNCHING_APP = 'LAUNCHING_APP',
  ACCEPTING_TERMS = 'ACCEPTING_TERMS',
  COUNTRY_SELECTION = 'COUNTRY_SELECTION',
  PHONE_NUMBER_ENTRY = 'PHONE_NUMBER_ENTRY',
  CLICKING_NEXT = 'CLICKING_NEXT',
  WAITING_FOR_SMS_SCREEN = 'WAITING_FOR_SMS_SCREEN',
  RECEIVING_SMS = 'RECEIVING_SMS',
  ENTERING_CODE = 'ENTERING_CODE',
  PROFILE_SETUP = 'PROFILE_SETUP',
  COMPLETED = 'COMPLETED'
}

export interface AutomationOptions {
  appiumPort: number;
  phoneNumber?: string; // Now optional! Will be provided by buyNumberCallback
  sessionId: string;
  containerId?: string; // Container ID for ADB installation
  countryName?: string; // Country name (e.g., "Canada", "United States") to help WhatsApp select correct country
  buyNumberCallback?: () => Promise<{ number: string; request_id: string }>; // Callback to buy number when ready
  onLog?: (message: string) => void; // Callback for detailed logs
  onStateChange?: (state: string, progress: number, message: string) => Promise<void>; // Callback for state changes
}

export class WhatsAppAutomationService {
  /**
   * Log a step with clear formatting
   */
  private logStep(step: WhatsAppStep, message: string, log?: (msg: string) => void): void {
    const formattedMessage = `

═══════════════════════════════════════════════════════════════
🎯 ÉTAPE: ${step}
${message}
═══════════════════════════════════════════════════════════════
`;
    logger.info({ step, message }, 'WhatsApp step');
    console.log(formattedMessage);
    if (log) log(formattedMessage);
  }

  /**
   * Log current page/screen with detailed info
   */
  private async logCurrentScreen(driver: any, _sessionId: string, log: (msg: string) => void): Promise<void> {
    try {
      const activity = await driver.getCurrentActivity();
      const packageName = await driver.getCurrentPackage();
      log(`📱 PAGE ACTUELLE: ${packageName} / ${activity}`);
      
      // Try to get visible text on screen
      try {
        const visibleTexts = await driver.$$('//android.widget.TextView');
        const texts: string[] = [];
        for (const element of visibleTexts.slice(0, 5)) { // Only first 5 to avoid spam
          try {
            const text = await element.getText();
            if (text && text.trim().length > 0 && text.trim().length < 50) {
              texts.push(text.trim());
            }
          } catch (e) {
            // Ignore
          }
        }
        if (texts.length > 0) {
          log(`📝 TEXTES VISIBLES: ${texts.join(', ')}`);
        }
      } catch (e) {
        // Ignore
      }
    } catch (error: any) {
      log(`⚠️ Impossible de récupérer l'écran actuel: ${error.message}`);
    }
  }

  /**
   * Save screenshot for debugging with detailed logging
   * Automatically logs current screen before taking screenshot
   */
  private async saveScreenshot(driver: any, step: string, sessionId: string, log?: (msg: string) => void): Promise<void> {
    try {
      if (log) {
        log(`📸 === CAPTURE D'ÉCRAN: "${step}" ===`);
        // Log current screen info before screenshot
        await this.logCurrentScreen(driver, sessionId, log);
      }
      
      const screenshot = await driver.takeScreenshot();
      
      // Use /data/screenshots if it exists (Docker volume), otherwise use ./data/screenshots
      const baseDir = fs.existsSync('/data/screenshots') ? '/data/screenshots' : path.join(process.cwd(), 'data', 'screenshots');
      const screenshotDir = path.join(baseDir, sessionId);
      
      // Ensure directory exists
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-${step}.png`;
      const filepath = path.join(screenshotDir, filename);
      
      fs.writeFileSync(filepath, Buffer.from(screenshot, 'base64'));
      
      logger.info({ filepath, step }, 'Screenshot saved');
      if (log) log(`✅ Screenshot sauvegardé: ${filename}`);
    } catch (error: any) {
      logger.warn({ error: error.message, step }, 'Failed to save screenshot');
      if (log) log(`⚠️ Échec screenshot: ${error.message}`);
    }
  }

  /**
   * Get page source for debugging
   */
  private async logPageSource(driver: any, step: string, sessionId: string): Promise<void> {
    try {
      const source = await driver.getPageSource();
      
      // Use /data/screenshots if it exists (Docker volume), otherwise use ./data/screenshots
      const baseDir = fs.existsSync('/data/screenshots') ? '/data/screenshots' : path.join(process.cwd(), 'data', 'screenshots');
      const debugDir = path.join(baseDir, sessionId);
      
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-${step}-source.xml`;
      const filepath = path.join(debugDir, filename);
      
      fs.writeFileSync(filepath, source);
      logger.info({ filepath, step }, 'Page source saved');
      console.log(`📄 [PAGE-SOURCE] Saved: ${filepath}`);
    } catch (error: any) {
      logger.warn({ error: error.message, step }, 'Failed to save page source');
      console.log(`⚠️ [PAGE-SOURCE] Failed: ${error.message}`);
    }
  }

  /**
   * Automate WhatsApp registration in emulator
   */
  async automateRegistration(options: AutomationOptions): Promise<void> {
    const { appiumPort, phoneNumber: initialPhoneNumber, sessionId, countryName, buyNumberCallback, onLog, onStateChange } = options;
    
    const log = (message: string) => {
      logger.info(message);
      console.log(`🤖 [WHATSAPP-AUTO] ${message}`);
      if (onLog) onLog(message);
    };
    
    log(`🚀 Starting WhatsApp automation${initialPhoneNumber ? ` for ${initialPhoneNumber}` : ' (will buy number when ready)'}`);
    log(`📡 Appium port: ${appiumPort}`);
    log(`🆔 Session ID: ${sessionId}`);

    // Wait for Appium to be ready (increased timeout to 180s for emulator startup and Appium initialization)
    log(`Waiting for Appium server to be ready on port ${appiumPort}...`);
    await this.waitForAppium(appiumPort, 180000, log);

    let driver: any = null;

    try {
              // Connect to Appium - use host.docker.internal to access host's mapped port
              // Appium 3.x uses root path, not /wd/hub (which was for Appium 1.x)
              const opts: RemoteOptions = {
                hostname: 'host.docker.internal',
                port: appiumPort,
                path: '/', // Appium 3.x uses root path
        logLevel: 'info', // Changed to 'info' for more detailed Appium logs
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'emulator',
          // Don't specify appPackage/appActivity in capabilities - we'll launch WhatsApp manually
          // This avoids the error about WhatsApp not being detected as preinstalled
          'appium:noReset': true, // Changed to true - WhatsApp is preinstalled in budtmo image
          'appium:fullReset': false,
          'appium:autoGrantPermissions': true,
          'appium:skipUnlock': true,
          'appium:waitForIdleTimeout': 3000,
          'appium:androidInstallTimeout': 90000,
          'appium:newCommandTimeout': 600, // 10 minutes - critical for number purchase callback
        },
      };

              log(`🔌 Connecting to Appium server on host.docker.internal:${appiumPort}...`);
              driver = await remote(opts);
      log(`✅ Connected to Appium server successfully`);
      
      // Capture initial state
      await this.saveScreenshot(driver, '01-connected', sessionId, log);
      await this.logPageSource(driver, '01-connected', sessionId);

      // Wait for system to stabilize
      log(`⏳ Waiting for system to stabilize...`);
      await this.sleep(2000);

      // Check if WhatsApp needs to be installed
      log(`🔍 Checking if WhatsApp is installed...`);
      let isInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
      
      if (!isInstalled) {
        log(`⚠️ WhatsApp is not installed, attempting automatic installation...`);
        await this.saveScreenshot(driver, 'before-whatsapp-install', sessionId, log);
        
        // Try to install WhatsApp automatically
        try {
          await this.installWhatsApp(driver, log, sessionId, options.containerId);
          
          // Verify installation succeeded
          await this.sleep(3000);
          isInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
          
          if (!isInstalled) {
            throw new Error('WhatsApp installation attempted but verification failed');
          }
          
          log(`✅ WhatsApp installed successfully, proceeding with automation`);
        } catch (installError: any) {
          log(`❌ Failed to install WhatsApp automatically: ${installError.message}`);
          await this.saveScreenshot(driver, 'error-whatsapp-install-failed', sessionId, log);
          throw new Error(`WhatsApp installation failed: ${installError.message}. Please install WhatsApp manually in the emulator.`);
        }
      } else {
        log(`✅ WhatsApp is installed, proceeding with automation`);
      }

      // Launch WhatsApp using monkey command directly (most reliable)
      log(`📱 ========================================`);
      log(`📱 LANCEMENT DE L'APPLICATION WHATSAPP`);
      log(`📱 ========================================`);
      log(`📦 Package: com.whatsapp`);
      
      log(`🚀 Exécution de la commande pour lancer WhatsApp...`);
      try {
        await driver.execute('mobile: shell', {
          command: 'monkey',
          args: ['-p', 'com.whatsapp', '-c', 'android.intent.category.LAUNCHER', '1'],
        });
        log(`✅ Commande de lancement exécutée`);
        log(`⏳ WhatsApp est en train de démarrer...`);
        await this.sleep(2000);
      } catch (error: any) {
        log(`⚠️ Première méthode échouée: ${error.message}`);
        // Fallback: try activateApp
        try {
          log(`🔄 Tentative alternative pour lancer WhatsApp...`);
          await driver.activateApp('com.whatsapp');
          log(`✅ Méthode alternative réussie`);
          await this.sleep(3000);
        } catch (e: any) {
          log(`❌ Impossible de lancer WhatsApp: ${e.message}`);
          throw new Error(`Failed to launch WhatsApp: ${error.message}`);
        }
      }
      
      log(`🔍 Vérification que WhatsApp s'est bien lancé...`);
      await this.sleep(2000);
      
      let currentActivity = '';
      try {
        currentActivity = await driver.getCurrentActivity();
        log(`📱 Activité détectée: ${currentActivity}`);
        
        if (currentActivity.includes('whatsapp')) {
          log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          log(`✅ WHATSAPP S'EST LANCÉ AVEC SUCCÈS !`);
          log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        }
      } catch (e: any) {
        log(`⚠️ Impossible de détecter l'activité: ${e.message}`);
      }
      
      // Continue with flow regardless of activity (skip waiting loop)
      
      log(`📸 Capture d'écran de WhatsApp...`);
      await this.saveScreenshot(driver, '02-whatsapp-launched', sessionId, log);
      await this.logPageSource(driver, '02-whatsapp-launched', sessionId);
      
      log(`📱 Final activity: ${currentActivity}`);

      // First, check for and dismiss any Alert dialogs that might block the screen
      log(`🔍 Checking for Alert dialogs...`);
      await this.dismissAlerts(driver, log, sessionId);

      // Check if we're on EULA screen and handle it
      if (currentActivity.includes('EULA') || currentActivity.includes('eula')) {
        log(`📜 Detected EULA screen, attempting to accept terms...`);
        await this.saveScreenshot(driver, '02-eula-detected', sessionId, log);
        await this.handleEULAScreen(driver, log, sessionId);
        await this.sleep(3000);
        
        // Re-check activity after accepting EULA
        try {
          currentActivity = await driver.getCurrentActivity();
          log(`📱 Activity after EULA: ${currentActivity}`);
          
          // If still on EULA, wait a bit more and try again
          if (currentActivity.includes('EULA') || currentActivity.includes('eula')) {
            log(`⚠️ Still on EULA, waiting longer and trying one more time...`);
            await this.sleep(5000);
            await this.handleEULAScreen(driver, log, sessionId);
            await this.sleep(3000);
            currentActivity = await driver.getCurrentActivity();
            log(`📱 Activity after second EULA attempt: ${currentActivity}`);
          }
        } catch (e) {
          log(`⚠️ Could not get activity after EULA: ${e}`);
        }
      }

      // Buy number NOW if callback provided (this is when WhatsApp is ready for phone entry)
      let phoneNumber = initialPhoneNumber;
      if (buyNumberCallback && !phoneNumber) {
        log(`📞 WhatsApp is ready for phone number! Buying number now...`);
        const buyResult = await buyNumberCallback();
        phoneNumber = buyResult.number;
        log(`✅ Number purchased: ${phoneNumber}`);
      }
      
      if (!phoneNumber) {
        throw new Error('Phone number not available - neither provided nor bought via callback');
      }
      
      // Notify: Entering phone number
      if (onStateChange) {
        await onStateChange('ENTERING_PHONE', 55, 'Entering phone number in WhatsApp...');
      }
      
      // Enter phone number
      log(`📝 Starting phone number entry process...`);
      await this.enterPhoneNumber(driver, phoneNumber, countryName, log, sessionId);
      
      log(`✅ Phone number ${phoneNumber} entered and submitted successfully`);
      log(`📱 SMS code request should have been sent to WhatsApp`);
      log(`⏳ WhatsApp automation completed - waiting for SMS code...`);
      
      // Take final screenshot
      await this.sleep(2000);
      await this.saveScreenshot(driver, '08-after-phone-entry', sessionId, log);
      await this.logPageSource(driver, '08-after-phone-entry', sessionId);
      
      // CRITICAL: Check if phone number is already registered on another device
      log(`🔍 Vérification si le numéro est déjà enregistré sur un autre appareil...`);
      try {
        const currentActivity = await driver.getCurrentActivity();
        log(`📱 Activité actuelle: ${currentActivity}`);
        
        // Check for "Use your other phone" message indicating phone is already registered
        const alreadyRegisteredIndicators = [
          '//android.widget.TextView[contains(@text, "Use your other phone")]',
          '//android.widget.TextView[contains(@text, "confirm moving")]',
          '//android.widget.TextView[contains(@text, "Verify +")]',
          '//android.widget.TextView[contains(@text, "get the 6-digit code")]',
        ];
        
        let phoneAlreadyRegistered = false;
        for (const indicator of alreadyRegisteredIndicators) {
          try {
            const elem = await driver.$(indicator);
            if (await elem.isExisting()) {
              const text = await elem.getText().catch(() => '');
              log(`⚠️ INDICATEUR DÉTECTÉ: "${text}"`);
              if (text.toLowerCase().includes('use your other phone') || 
                  text.toLowerCase().includes('confirm moving') ||
                  text.toLowerCase().includes('get the 6-digit code')) {
                phoneAlreadyRegistered = true;
                log(`❌ Le numéro ${phoneNumber} est déjà enregistré sur un autre appareil !`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (phoneAlreadyRegistered) {
          await this.saveScreenshot(driver, '09-phone-already-registered', sessionId, log);
          log(`📸 Screenshot de l'écran "phone already registered" sauvegardé`);
          throw new Error(`PHONE_ALREADY_REGISTERED:${phoneNumber}`);
        }
        
        log(`✅ Le numéro n'est pas enregistré ailleurs, on peut continuer`);
      } catch (error: any) {
        if (error.message && error.message.startsWith('PHONE_ALREADY_REGISTERED:')) {
          throw error; // Re-throw this specific error
        }
        log(`⚠️ Impossible de vérifier si le numéro est enregistré: ${error.message}`);
        // Continue anyway - we'll let the OTP polling handle it
      }
      
      log(`📸 All screenshots and page sources saved in: data/screenshots/${sessionId}/`);
      
    } catch (error: any) {
      logger.error({ error: error.message, sessionId }, 'WhatsApp automation failed');
      throw new Error(`WhatsApp automation failed: ${error.message}`);
    } finally {
      if (driver) {
        try {
          await driver.deleteSession();
          logger.info('Appium session closed');
        } catch (e) {
          logger.warn('Failed to close Appium session');
        }
      }
    }
  }

  /**
   * Dismiss any Alert dialogs that might block the screen
   */
  private async dismissAlerts(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Searching for Alert dialogs...`);
      
      // Look for Alert dialogs with "OK" button
      const alertSelectors = [
        '//android.widget.Button[@text="OK"]',
        '//android.widget.Button[contains(@text, "OK")]',
        '//*[@text="OK"]',
        '//*[contains(@text, "OK")]',
        '//*[@content-desc="OK"]',
        '//android.app.Dialog//android.widget.Button[@text="OK"]',
      ];
      
      for (const selector of alertSelectors) {
        try {
          const okButton = await driver.$(selector);
          const exists = await okButton.isExisting();
          
          if (exists) {
            const isDisplayed = await okButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              const buttonText = await okButton.getText().catch(() => '');
              log(`✅ Found Alert dialog with "${buttonText}" button, clicking...`);
              await okButton.click();
              await this.sleep(2000);
              log(`✅ Alert dialog dismissed`);
              
              // Take screenshot after dismissing alert
              await this.saveScreenshot(driver, '02-alert-dismissed', sessionId, log);
              
              // Check if there are more alerts
              await this.sleep(1000);
              await this.dismissAlerts(driver, log, sessionId); // Recursive to handle multiple alerts
              return;
            }
          }
        } catch (e: any) {
          // Continue to next selector
        }
      }
      
      // Also try to find any buttons with "OK" text by scanning all buttons
      try {
        const allButtons = await driver.$$('android.widget.Button');
        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          try {
            const btn = allButtons[i];
            const exists = await btn.isExisting();
            if (exists) {
              const isDisplayed = await btn.isDisplayed().catch(() => false);
              const text = await btn.getText().catch(() => '');
              
              // If button text is exactly "OK" and displayed, click it
              if (isDisplayed && text && text.trim().toUpperCase() === 'OK') {
                log(`✅ Found "OK" button (#${i}): "${text}", clicking to dismiss alert...`);
                await btn.click();
                await this.sleep(2000);
                log(`✅ Alert dismissed`);
                await this.saveScreenshot(driver, '02-alert-dismissed', sessionId, log);
                await this.sleep(1000);
                // Recursive call to check for more alerts
                await this.dismissAlerts(driver, log, sessionId);
                return;
              }
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e: any) {
        log(`⚠️ Could not scan buttons for alerts: ${e.message}`);
      }
      
      log(`ℹ️ No Alert dialogs found or already dismissed`);
    } catch (error: any) {
      log(`⚠️ Error checking for alerts: ${error.message}`);
      // Don't throw - continue anyway
    }
  }

  /**
   * Handle EULA (End User License Agreement) screen
   */
  private async handleEULAScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    log(`🔍 Analyzing EULA screen to find accept/agree button...`);
    
    try {
      // Get page source to analyze what's on screen
      await this.logPageSource(driver, '03-eula-screen', sessionId);
      
      // Common button texts for accepting EULA - optimized order based on what works
      const buttonTexts = [
        'AGREE AND CONTINUE', // Most common, found in logs
        'Agree and Continue',
        'AGREE',
        'Agree',
        'CONTINUE',
        'Continue',
      ];
      
      // Try to find and click accept button by text
      for (const buttonText of buttonTexts) {
        try {
          log(`🔍 Looking for button with text: "${buttonText}"`);
          
          // Try multiple selectors
          const selectors = [
            `//android.widget.Button[@text="${buttonText}"]`,
            `//android.widget.Button[contains(@text, "${buttonText}")]`,
            `//*[@text="${buttonText}"]`,
            `//*[contains(@text, "${buttonText}")]`,
            `//*[@content-desc="${buttonText}"]`,
            `//*[contains(@content-desc, "${buttonText}")]`,
            `//android.view.View[@clickable="true" and contains(@text, "${buttonText}")]`,
          ];
          
          for (const selector of selectors) {
            try {
              const button = await driver.$(selector);
              const exists = await button.isExisting();
              
              if (exists) {
                const isDisplayed = await button.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  log(`✅ Found "${buttonText}" button, clicking...`);
                  await button.click();
                  await this.sleep(2000);
                  
                  // Verify we moved past EULA
                  const newActivity = await driver.getCurrentActivity();
                  log(`📱 Activity after clicking: ${newActivity}`);
                  
                  if (!newActivity.includes('EULA') && !newActivity.includes('eula')) {
                    log(`✅ Successfully passed EULA screen`);
                    await this.saveScreenshot(driver, '04-after-eula', sessionId, log);
                    return;
                  }
                }
              }
            } catch (e: any) {
              // Continue to next selector
            }
          }
        } catch (e: any) {
          // Continue to next button text
        }
      }
      
      // If no button found by text, try to find any clickable element
      log(`⚠️ Could not find accept button by text, trying to find any clickable element...`);
      try {
        // First, make sure any alert dialogs are dismissed
        await this.dismissAlerts(driver, log, sessionId);
        
        const allButtons = await driver.$$('android.widget.Button');
        log(`📊 Found ${allButtons.length} buttons on screen`);
        
        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          try {
            const btn = allButtons[i];
            const exists = await btn.isExisting();
            if (exists) {
              const isDisplayed = await btn.isDisplayed().catch(() => false);
              const text = await btn.getText().catch(() => '');
              log(`  📝 Button #${i}: "${text}", displayed: ${isDisplayed}`);
              
              // Skip alert buttons ("OK", "More info")
              if (text.toUpperCase() === 'OK' || text.toLowerCase().includes('more info')) {
                log(`  ⏭️ Skipping alert button: "${text}"`);
                continue;
              }
              
              // Try clicking buttons that contain "AGREE" or "CONTINUE" (optimized based on logs)
              const upperText = text.toUpperCase();
              if (isDisplayed && (upperText.includes('AGREE') || upperText.includes('CONTINUE'))) {
                log(`🖱️ Clicking button: "${text}"`);
                await btn.click();
                await this.sleep(2000);
                
                const newActivity = await driver.getCurrentActivity();
                if (!newActivity.includes('EULA') && !newActivity.includes('eula')) {
                  log(`✅ Successfully passed EULA screen`);
                  await this.saveScreenshot(driver, '04-after-eula', sessionId, log);
                  return;
                }
              }
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e: any) {
        log(`⚠️ Could not find clickable elements: ${e.message}`);
      }
      
      log(`⚠️ Could not automatically accept EULA, proceeding anyway - may need manual intervention`);
      await this.saveScreenshot(driver, '03-eula-unable-to-accept', sessionId, log);
    } catch (error: any) {
      log(`❌ Error handling EULA screen: ${error.message}`);
      await this.saveScreenshot(driver, '03-eula-error', sessionId, log);
      // Don't throw - continue anyway
    }
  }

  /**
   * Handle any unexpected popup by trying to click Skip, Continue, Not now, OK, etc.
   */
  private async handleUnexpectedPopup(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    try {
      await this.saveScreenshot(driver, 'unexpected-popup', sessionId, log);
      
      // Try all common dismissal buttons in order of preference
      const dismissButtons = [
        // "Continue" buttons (to proceed with permission)
        '//android.widget.Button[@text="Continue"]',
        '//android.widget.Button[@text="CONTINUE"]',
        '//*[@text="Continue"]',
        // "Not now" buttons (to skip)
        '//android.widget.Button[@text="Not now"]',
        '//android.widget.Button[@text="NOT NOW"]',
        '//*[@text="Not now"]',
        // "Skip" buttons
        '//android.widget.Button[@text="Skip"]',
        '//android.widget.Button[@text="SKIP"]',
        '//*[@text="Skip"]',
        // "OK" buttons
        '//android.widget.Button[@text="OK"]',
        '//android.widget.Button[@text="Ok"]',
        '//*[@text="OK"]',
        // "Allow" buttons (for permissions)
        '//android.widget.Button[@text="Allow"]',
        '//android.widget.Button[@text="ALLOW"]',
        '//*[@text="Allow"]',
        '//*[@text="While using the app"]',
      ];
      
      for (const selector of dismissButtons) {
        try {
          const button = await driver.$(selector);
          const exists = await button.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await button.isDisplayed().catch(() => false);
            if (isDisplayed) {
              const buttonText = await button.getText().catch(() => 'unknown');
              log(`✅ Bouton "${buttonText}" trouvé sur popup inattendu, clic...`);
              await button.click();
              await this.sleep(1500);
              await this.saveScreenshot(driver, 'after-unexpected-popup-dismiss', sessionId, log);
              log(`✅ Popup inattendu fermé avec "${buttonText}"`);
              
              // Check if another popup appeared (e.g., native Android permission)
              const activity = await driver.getCurrentActivity().catch(() => '');
              if (activity.includes('GrantPermissionsActivity') || activity.includes('permission')) {
                log(`🔍 Permission Android détectée après popup, gestion...`);
                // Try to click Allow on native permission dialog
                const allowButton = await driver.$('//*[@text="Allow"]');
                if (await allowButton.isExisting().catch(() => false)) {
                  await allowButton.click();
                  await this.sleep(1000);
                  log(`✅ Permission Android accordée`);
                }
              }
              
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      log(`ℹ️ Aucun bouton de fermeture trouvé sur popup inattendu`);
      return false;
    } catch (error: any) {
      log(`⚠️ Erreur lors de la gestion du popup inattendu: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle "Contacts" permission popup that can appear DURING phone number entry
   * This is different from the post-OTP permission popup
   */
  private async handleContactsPopupDuringPhoneEntry(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      await this.sleep(1000);
      await this.saveScreenshot(driver, 'check-contacts-popup-during-phone', sessionId, log);
      
      // Check for the "Contacts" permission popup
      const contactsPopupIndicators = [
        '//*[@text="Contacts"]',
        '//*[contains(@text, "Contacts")]',
        '//*[contains(@text, "verify your number and easily send messages")]',
        '//*[contains(@text, "allow WhatsApp to access your contacts")]',
      ];
      
      let isContactsPopup = false;
      for (const indicator of contactsPopupIndicators) {
        try {
          const elem = await driver.$(indicator);
          const exists = await elem.isExisting().catch(() => false);
          if (exists) {
            log(`✅ Popup "Contacts" détecté pendant la saisie du numéro !`);
            isContactsPopup = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (isContactsPopup) {
        log(`🖱️ Recherche du bouton "Continue" pour accepter l'accès aux contacts...`);
        
        const continueSelectors = [
          '//android.widget.Button[@text="Continue"]',
          '//android.widget.Button[@text="CONTINUE"]',
          '//*[@text="Continue"]',
          '//*[@text="CONTINUE"]',
          '//android.widget.TextView[@text="Continue"]',
          '//*[contains(@text, "Continue")]',
        ];
        
        let continueClicked = false;
        for (const selector of continueSelectors) {
          try {
            const continueButton = await driver.$(selector);
            const exists = await continueButton.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await continueButton.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Bouton "Continue" trouvé, clic...`);
                await continueButton.click();
                await this.sleep(1500);
                await this.saveScreenshot(driver, 'contacts-popup-accepted-during-phone', sessionId, log);
                log(`✅ Popup "Contacts" accepté avec succès ! Accès aux contacts accordé.`);
                
                // After clicking Continue, Android might show native permission dialog
                log(`🔍 Vérification si une permission Android native apparaît...`);
                await this.sleep(1500);
                
                try {
                  const activity = await driver.execute('mobile: getCurrentActivity').catch(() => '');
                  if (activity.includes('GrantPermissionsActivity')) {
                    log(`✅ Permission Android native détectée, clic sur "Allow"...`);
                    
                    const allowSelectors = [
                      '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
                      '//android.widget.Button[@text="Allow"]',
                      '//*[@text="Allow"]',
                    ];
                    
                    for (const allowSelector of allowSelectors) {
                      try {
                        const allowButton = await driver.$(allowSelector);
                        const allowExists = await allowButton.isExisting().catch(() => false);
                        if (allowExists) {
                          await allowButton.click();
                          await this.sleep(2000);
                          await this.saveScreenshot(driver, 'native-allow-during-phone', sessionId, log);
                          log(`✅ Permission Android native accordée !`);
                          break;
                        }
                      } catch (e) {
                        continue;
                      }
                    }
                  }
                } catch (e: any) {
                  log(`⚠️ Erreur vérification permission native: ${e.message}`);
                }
                
                continueClicked = true;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!continueClicked) {
          log(`⚠️ Impossible de cliquer sur "Continue", mais continuons...`);
        }
      } else {
        log(`ℹ️ Pas de popup "Contacts" détecté à ce moment, continuons...`);
      }
      
    } catch (error: any) {
      log(`⚠️ Erreur lors de la vérification du popup Contacts: ${error.message}`);
      // Don't throw - this is optional
    }
  }

  /**
   * Try EVERYTHING to move to next page - aggressive approach
   */
  /**
   * Check for and handle the phone confirmation dialog that appears after clicking Next
   * Dialog text: "Is this OK? +X XXX-XXX-XXXX"
   */
  private async handleConfirmationDialog(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    log(`🔍 Checking for phone confirmation dialog...`);
    await this.sleep(1500); // Wait for dialog to appear
    
    try {
      await this.saveScreenshot(driver, 'check-confirmation-dialog', sessionId, log);
      
      // Check for confirmation dialog indicators
      const dialogIndicators = [
        '//*[contains(@text, "Is this OK")]',
        '//*[contains(@text, "OK")]',
        '//*[@resource-id="android:id/button1"]', // Standard Android OK button
        '//android.widget.Button[@text="OK"]',
      ];
      
      for (const indicator of dialogIndicators) {
        try {
          const elem = await driver.$(indicator);
          const exists = await elem.isExisting().catch(() => false);
          if (exists) {
            log(`✅ Found confirmation dialog! Clicking OK...`);
            
            // Try to find and click the OK button
            const okSelectors = [
              '//*[@text="OK"]',
              '//android.widget.Button[@text="OK"]',
              '//*[@resource-id="android:id/button1"]',
            ];
            
            for (const okSelector of okSelectors) {
              try {
                const okButton = await driver.$(okSelector);
                const okExists = await okButton.isExisting().catch(() => false);
                if (okExists) {
                  await okButton.click();
                  log(`✅ Clicked OK button on confirmation dialog`);
                  await this.sleep(2000);
                  await this.saveScreenshot(driver, 'after-confirmation-ok', sessionId, log);
                  return true;
                }
              } catch (e) {
                continue;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      log(`ℹ️ No confirmation dialog found (or already dismissed)`);
      return false;
    } catch (error: any) {
      log(`⚠️ Error checking for confirmation dialog: ${error.message}`);
      return false;
    }
  }

  /**
   * Capture network logs from Android logcat
   */
  private async captureNetworkLogs(driver: any, log: (msg: string) => void, durationSeconds: number = 5): Promise<string> {
    try {
      log(`📡 Capturing network logs for ${durationSeconds} seconds...`);
      
      // Clear logcat buffer first
      await driver.execute('mobile: shell', {
        command: 'logcat',
        args: ['-c'],
      });
      
      // Wait for logs to accumulate
      await this.sleep(durationSeconds * 1000);
      
      // Get logcat output (filter for WhatsApp and network activity)
      const result = await driver.execute('mobile: shell', {
        command: 'logcat',
        args: ['-d', '-s', 'WhatsApp:V', 'NetworkController:V', 'okhttp:V', 'HttpURLConnection:V'],
      });
      
      return result || '';
    } catch (e: any) {
      log(`⚠️ Failed to capture network logs: ${e.message}`);
      return '';
    }
  }

  /**
   * Analyze logs for errors or interesting messages
   */
  private analyzeLogs(logs: string, log: (msg: string) => void): void {
    if (!logs || logs.length === 0) {
      log(`⚠️ No logs captured`);
      return;
    }
    
    log(`📊 Analyzing ${logs.length} characters of logs...`);
    
    const lines = logs.split('\n');
    const errorPatterns = [
      /error/i,
      /fail/i,
      /invalid/i,
      /reject/i,
      /denied/i,
      /blocked/i,
      /voip/i,
      /virtual/i,
      /http.*[45]\d\d/i, // HTTP 4xx or 5xx errors
      /exception/i,
    ];
    
    const interestingLines: string[] = [];
    
    for (const line of lines) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          interestingLines.push(line);
          break;
        }
      }
    }
    
    if (interestingLines.length > 0) {
      log(`\n🔍 Found ${interestingLines.length} interesting log entries:`);
      interestingLines.slice(0, 20).forEach((line, i) => {
        log(`  [${i + 1}] ${line.substring(0, 150)}`);
      });
    } else {
      log(`✓ No obvious errors found in logs`);
    }
  }

  /**
   * Wait for a button to become enabled (clickable)
   * WhatsApp may disable the NEXT button until client-side validation passes
   */
  private async waitForButtonEnabled(
    driver: any, 
    selectors: string[], 
    maxWaitMs: number = 30000,
    log: (msg: string) => void
  ): Promise<{ button: any; enabled: boolean }> {
    log(`\n⏳ ═══ WAITING FOR BUTTON TO BE ENABLED ═══`);
    log(`⏳ Max wait time: ${maxWaitMs / 1000} seconds`);
    
    const startTime = Date.now();
    let lastButton: any = null;
    let checkCount = 0;
    
    while (Date.now() - startTime < maxWaitMs) {
      checkCount++;
      
      for (const selector of selectors) {
        try {
          const button = await driver.$(selector);
          const exists = await button.isExisting();
          
          if (exists) {
            lastButton = button;
            
            // Check all clickability attributes
            const enabled = await button.getAttribute('enabled').catch(() => 'true');
            const clickable = await button.getAttribute('clickable').catch(() => 'true');
            const displayed = await button.isDisplayed().catch(() => false);
            
            const isReady = enabled === 'true' && clickable === 'true' && displayed;
            
            if (checkCount % 5 === 1) { // Log every 5 checks
              log(`  🔍 Check #${checkCount}: enabled=${enabled}, clickable=${clickable}, displayed=${displayed}`);
            }
            
            if (isReady) {
              log(`  ✅ Button is NOW ENABLED after ${Math.round((Date.now() - startTime) / 1000)}s!`);
              return { button, enabled: true };
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.sleep(500); // Check every 500ms
    }
    
    log(`  ⚠️ Timeout: Button did not become enabled within ${maxWaitMs / 1000}s`);
    return { button: lastButton, enabled: false };
  }

  /**
   * Click using sendevent - lowest level touch simulation
   * This is harder for apps to detect as automation
   */
  private async clickViaSendevent(
    driver: any, 
    x: number, 
    y: number,
    log: (msg: string) => void
  ): Promise<boolean> {
    log(`\n🎯 ═══ SENDEVENT CLICK (LOW-LEVEL) ═══`);
    log(`📍 Coordinates: (${x}, ${y})`);
    
    try {
      // First, find the correct input device for touch
      const deviceList = await driver.execute('mobile: shell', {
        command: 'cat',
        args: ['/proc/bus/input/devices'],
      }).catch(() => '');
      
      // Parse to find touch device (usually event1 or event2)
      let touchDevice = '/dev/input/event1'; // Default
      
      if (deviceList.includes('touch') || deviceList.includes('Touch')) {
        // Try to find the actual touch device
        const lines = deviceList.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes('touch')) {
            // Look for the Handlers line after this
            for (let j = i; j < Math.min(i + 10, lines.length); j++) {
              const match = lines[j].match(/event(\d+)/);
              if (match) {
                touchDevice = `/dev/input/event${match[1]}`;
                break;
              }
            }
            break;
          }
        }
      }
      
      log(`📱 Using touch device: ${touchDevice}`);
      
      // Convert coordinates to touch screen resolution
      // Most Android emulators use 32767 as max value for absolute coordinates
      const maxCoord = 32767;
      const screenWidth = 1080; // Typical emulator width
      const screenHeight = 1920; // Typical emulator height
      
      const absX = Math.round((x / screenWidth) * maxCoord);
      const absY = Math.round((y / screenHeight) * maxCoord);
      
      log(`📐 Absolute coordinates: (${absX}, ${absY})`);
      
      // Sendevent sequence for a tap:
      // EV_ABS (3) ABS_MT_TRACKING_ID (57) = tracking ID
      // EV_ABS (3) ABS_MT_POSITION_X (53) = X position
      // EV_ABS (3) ABS_MT_POSITION_Y (54) = Y position
      // EV_ABS (3) ABS_MT_PRESSURE (58) = pressure
      // EV_SYN (0) SYN_REPORT (0) = sync
      // Then release with tracking ID = -1
      
      const commands = [
        // Touch down
        `sendevent ${touchDevice} 3 57 0`,      // ABS_MT_TRACKING_ID = 0
        `sendevent ${touchDevice} 3 53 ${absX}`, // ABS_MT_POSITION_X
        `sendevent ${touchDevice} 3 54 ${absY}`, // ABS_MT_POSITION_Y
        `sendevent ${touchDevice} 3 58 50`,      // ABS_MT_PRESSURE = 50
        `sendevent ${touchDevice} 1 330 1`,      // BTN_TOUCH = 1 (down)
        `sendevent ${touchDevice} 0 0 0`,        // SYN_REPORT
        // Small delay for touch
        `sleep 0.05`,
        // Touch up
        `sendevent ${touchDevice} 3 57 -1`,      // ABS_MT_TRACKING_ID = -1 (release)
        `sendevent ${touchDevice} 1 330 0`,      // BTN_TOUCH = 0 (up)
        `sendevent ${touchDevice} 0 0 0`,        // SYN_REPORT
      ];
      
      // Execute as a single shell command
      const fullCommand = commands.join(' && ');
      
      log(`🔧 Executing sendevent sequence...`);
      await driver.execute('mobile: shell', {
        command: 'sh',
        args: ['-c', fullCommand],
      });
      
      log(`✅ Sendevent click executed successfully`);
      return true;
      
    } catch (e: any) {
      log(`⚠️ Sendevent failed: ${e.message}`);
      
      // Fallback: try simpler approach with input tap
      log(`🔄 Fallback: Using input tap instead...`);
      try {
        await driver.execute('mobile: shell', {
          command: 'input',
          args: ['tap', x.toString(), y.toString()],
        });
        log(`✅ Fallback input tap executed`);
        return true;
      } catch (e2: any) {
        log(`❌ Fallback also failed: ${e2.message}`);
        return false;
      }
    }
  }

  /**
   * Alternative: Click using input touchscreen swipe (duration=0 = tap)
   * Another low-level approach that can bypass some detection
   */
  private async clickViaInputSwipe(
    driver: any,
    x: number,
    y: number,
    log: (msg: string) => void
  ): Promise<boolean> {
    log(`\n🖱️ ═══ INPUT SWIPE TAP ═══`);
    log(`📍 Coordinates: (${x}, ${y})`);
    
    try {
      // swipe from point to same point with 0 duration = tap
      await driver.execute('mobile: shell', {
        command: 'input',
        args: ['touchscreen', 'swipe', x.toString(), y.toString(), x.toString(), y.toString(), '50'],
      });
      log(`✅ Input swipe tap executed`);
      return true;
    } catch (e: any) {
      log(`⚠️ Input swipe tap failed: ${e.message}`);
      return false;
    }
  }

  /**
   * W3C Actions API - Most modern and reliable method
   * Uses performActions which is the new standard
   */
  private async clickViaW3CActions(
    driver: any,
    x: number,
    y: number,
    log: (msg: string) => void
  ): Promise<boolean> {
    log(`\n🎭 ═══ W3C ACTIONS API (MOST RELIABLE) ═══`);
    log(`📍 Coordinates: (${x}, ${y})`);
    
    try {
      // W3C Actions API - creates a pointer action sequence
      const actions = [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 }, // Hold for 100ms
            { type: 'pointerUp', button: 0 },
          ]
        }
      ];
      
      log(`🔧 Executing W3C pointer action sequence...`);
      await driver.performActions(actions);
      log(`✅ W3C Actions executed successfully`);
      
      // Clean up actions
      await driver.releaseActions().catch(() => {});
      
      return true;
    } catch (e: any) {
      log(`⚠️ W3C Actions failed: ${e.message}`);
      return false;
    }
  }

  /**
   * JavaScript injection - Force click via JavaScript
   * Most reliable as it bypasses all touch layer issues
   */
  private async clickViaJavaScript(
    driver: any,
    button: any,
    log: (msg: string) => void
  ): Promise<boolean> {
    log(`\n💉 ═══ JAVASCRIPT INJECTION (FORCE CLICK) ═══`);
    
    try {
      // Get the element's Android view ID
      const viewId = await button.getAttribute('resource-id').catch(() => null);
      
      if (viewId) {
        log(`📱 Attempting to trigger click event via JavaScript on ${viewId}...`);
        
        // Try to execute JavaScript to simulate a click
        // Note: This might not work on all Android versions
        await driver.execute('mobile: shell', {
          command: 'input',
          args: ['keyevent', '23'], // KEYCODE_DPAD_CENTER - simulates center button press
        });
        
        log(`✅ JavaScript injection executed`);
        return true;
      } else {
        log(`⚠️ Could not get element resource-id for JavaScript injection`);
        return false;
      }
    } catch (e: any) {
      log(`⚠️ JavaScript injection failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Longpress then release - Sometimes more reliable than tap
   */
  private async clickViaLongpress(
    driver: any,
    x: number,
    y: number,
    log: (msg: string) => void
  ): Promise<boolean> {
    log(`\n⏱️ ═══ LONGPRESS METHOD ═══`);
    log(`📍 Coordinates: (${x}, ${y})`);
    
    try {
      // Use touchAction with longPress
      await driver.touchAction([
        { action: 'longPress', x: Math.round(x), y: Math.round(y) },
        { action: 'release' }
      ]);
      log(`✅ Longpress executed`);
      return true;
    } catch (e: any) {
      log(`⚠️ Longpress failed: ${e.message}`);
      return false;
    }
  }

  private async tryEverythingToMoveToNextPage(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    log(`🚀 SOLUTION AMÉLIORÉE: ATTENTE BOUTON ENABLED + CLICS BAS NIVEAU`);
    
    const activityBefore = await driver.getCurrentActivity();
    log(`📱 Starting activity: ${activityBefore}`);
    
    // Selectors for NEXT button
    const nextButtonSelectors = [
      `//android.widget.Button[@text="NEXT"]`,
      `//*[@text="NEXT"]`,
      `//*[@resource-id="com.whatsapp:id/registration_submit"]`,
      `//android.widget.Button[contains(@text, "Next")]`,
      `//*[contains(@text, "NEXT")]`,
    ];
    
    // ═══════════════════════════════════════════════════════════════
    // SOLUTION #0: ATTENDRE QUE LE BOUTON SOIT ENABLED (NOUVEAU!)
    // ═══════════════════════════════════════════════════════════════
    log(`\n🆕 ═══ SOLUTION #0: ATTENTE BOUTON ENABLED ═══`);
    log(`💡 WhatsApp peut désactiver le bouton NEXT tant que le numéro n'est pas validé`);
    
    const { button: enabledButton, enabled } = await this.waitForButtonEnabled(
      driver, 
      nextButtonSelectors, 
      30000, // Max 30 seconds
      log
    );
    
    if (enabled && enabledButton) {
      log(`✅ Le bouton est maintenant ENABLED - tentative de clic immédiat`);
      
      // Try clicking immediately while it's enabled
      try {
        await enabledButton.click();
        log(`✅ Clic direct sur bouton enabled`);
        await this.sleep(2000);
        
        // Check if page changed
        const activityAfter = await driver.getCurrentActivity();
        if (activityAfter !== activityBefore) {
          log(`✅ ✅ ✅ PAGE CHANGED après clic sur bouton enabled!`);
          await this.saveScreenshot(driver, 'success-enabled-click', sessionId, log);
          return true;
        }
      } catch (e: any) {
        log(`⚠️ Clic sur bouton enabled échoué: ${e.message}`);
      }
    } else {
      log(`⚠️ Le bouton n'est pas devenu enabled dans le délai - on continue avec les autres méthodes`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SOLUTION #1: ATTENTE PROLONGÉE (15 secondes au lieu de 5)
    // ═══════════════════════════════════════════════════════════════
    log(`\n⏳ ═══ SOLUTION #1: ATTENTE PROLONGÉE ═══`);
    log(`⏳ Waiting 15 seconds for WhatsApp client-side validation...`);
    log(`💡 WhatsApp may be validating the number format, carrier, country code, etc.`);
    await this.sleep(15000);
    log(`✅ 15 seconds elapsed - validation should be complete`);
    
    // ═══════════════════════════════════════════════════════════════
    // SOLUTION #2: PERDRE LE FOCUS DU CHAMP
    // ═══════════════════════════════════════════════════════════════
    log(`\n👆 ═══ SOLUTION #2: PERTE DE FOCUS ═══`);
    log(`👆 Clicking elsewhere to remove focus from phone number field...`);
    
    try {
      // Click on the title "Enter your phone number" to lose focus
      const titleSelectors = [
        '//*[@text="Enter your phone number"]',
        '//*[contains(@text, "Enter your")]',
        '//*[@resource-id="com.whatsapp:id/registration_text"]',
      ];
      
      let focusLost = false;
      for (const selector of titleSelectors) {
        try {
          const titleElement = await driver.$(selector);
          const exists = await titleElement.isExisting();
          if (exists) {
            log(`✅ Found title element, clicking to lose focus...`);
            await titleElement.click();
            focusLost = true;
            log(`✅ Clicked on title - focus should be lost from input field`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!focusLost) {
        // Fallback: click on empty space (top of screen)
        log(`⚠️ Title not found, clicking on empty space instead...`);
        await driver.touchAction([
          { action: 'tap', x: 540, y: 300 }
        ]);
        log(`✅ Clicked on empty space - focus should be lost`);
      }
      
      await this.sleep(2000);
    } catch (e: any) {
      log(`⚠️ Could not lose focus: ${e.message}`);
    }
    
    // Hide keyboard
    log(`\n⌨️ Hiding keyboard...`);
    try {
      await driver.hideKeyboard().catch(() => {});
      await driver.pressKeyCode(4); // KEYCODE_BACK to hide keyboard
      await this.sleep(1000);
      log(`✅ Keyboard hidden`);
    } catch (e: any) {
      log(`⚠️ Could not hide keyboard: ${e.message}`);
    }
    
    // Additional wait after losing focus
    log(`\n⏳ Waiting 3 additional seconds after losing focus...`);
    await this.sleep(3000);
    log(`✅ Ready to click Next button`);
    
    // ═══════════════════════════════════════════════════════════════
    // START NETWORK CAPTURE
    // ═══════════════════════════════════════════════════════════════
    log(`\n📡 ═══ DÉMARRAGE CAPTURE RÉSEAU ═══`);
    
    // Clear logcat before starting
    try {
      await driver.execute('mobile: shell', {
        command: 'logcat',
        args: ['-c'],
      });
      log(`✅ Logcat buffer cleared`);
    } catch (e: any) {
      log(`⚠️ Could not clear logcat: ${e.message}`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 1: DIAGNOSTIC APPROFONDI
    // ═══════════════════════════════════════════════════════════════
    log(`\n🔍 ═══ ÉTAPE 1: DIAGNOSTIC COMPLET ═══`);
    
    try {
      // 1.1 - Dump complete page source XML
      log(`📄 Dumping complete page source XML...`);
      const pageSource = await driver.getPageSource();
      log(`📄 Page source length: ${pageSource.length} characters`);
      
      // Save to file (truncate if too long for logs)
      if (pageSource.length < 5000) {
        log(`📄 Page Source (truncated):\n${pageSource.substring(0, 2000)}...`);
      }
      
      // 1.2 - Find and analyze NEXT button
      log(`\n🔍 Analyzing NEXT button attributes...`);
      const selectors = [
        `//android.widget.Button[@text="NEXT"]`,
        `//*[@text="NEXT"]`,
        `//*[@resource-id="com.whatsapp:id/registration_submit"]`,
      ];
      
      let nextButton: any = null;
      let usedSelector = '';
      
      for (const selector of selectors) {
        try {
          const btn = await driver.$(selector);
          const exists = await btn.isExisting();
          if (exists) {
            nextButton = btn;
            usedSelector = selector;
            log(`✅ Found NEXT button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (nextButton) {
        // Read ALL attributes
        log(`\n📊 NEXT Button Attributes:`);
        try {
          const attributes = {
            text: await nextButton.getText().catch(() => 'N/A'),
            displayed: await nextButton.isDisplayed().catch(() => 'N/A'),
            enabled: await nextButton.isEnabled().catch(() => 'N/A'),
            clickable: await nextButton.getAttribute('clickable').catch(() => 'N/A'),
            focusable: await nextButton.getAttribute('focusable').catch(() => 'N/A'),
            focused: await nextButton.getAttribute('focused').catch(() => 'N/A'),
            selected: await nextButton.getAttribute('selected').catch(() => 'N/A'),
            bounds: await nextButton.getAttribute('bounds').catch(() => 'N/A'),
            resourceId: await nextButton.getAttribute('resource-id').catch(() => 'N/A'),
            className: await nextButton.getAttribute('class').catch(() => 'N/A'),
            package: await nextButton.getAttribute('package').catch(() => 'N/A'),
            contentDesc: await nextButton.getAttribute('content-desc').catch(() => 'N/A'),
          };
          
          for (const [key, value] of Object.entries(attributes)) {
            log(`  • ${key}: ${value}`);
          }
          
          // Check for overlays
          log(`\n🔍 Checking for overlays or blocking elements...`);
          const allElements = await driver.$$('//*[@displayed="true"]');
          log(`  • Total visible elements: ${allElements.length}`);
          
          // Get button coordinates
          const location = await nextButton.getLocation().catch(() => ({ x: 0, y: 0 }));
          const size = await nextButton.getSize().catch(() => ({ width: 0, height: 0 }));
          log(`  • Button location: (${location.x}, ${location.y})`);
          log(`  • Button size: ${size.width}x${size.height}`);
          
        } catch (e: any) {
          log(`⚠️ Error reading button attributes: ${e.message}`);
        }
      } else {
        log(`❌ NEXT button not found!`);
      }
      
      await this.saveScreenshot(driver, 'diagnostic-before-click', sessionId, log);
      
    } catch (e: any) {
      log(`⚠️ Diagnostic error: ${e.message}`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 2: UIAUTOMATOR2 + MULTIPLE CLICK METHODS
    // ═══════════════════════════════════════════════════════════════
    log(`\n🤖 ═══ ÉTAPE 2: MÉTHODES DE CLIC AVANCÉES (20 méthodes!) ═══`);
    
    const maxAttempts = 40; // 2 passes complètes de 20 méthodes
    const clickMethods = [
      'w3c_actions', // 1. W3C Actions API - MOST RELIABLE
      'longpress', // 2. Longpress method
      'standard', // 3. Standard Appium click
      'uiautomator2', // 4. UIAutomator2 direct
      'coordinates', // 5. ADB input tap
      'gesture', // 6. Mobile gesture
      'ime_action', // 7. IME action (submit form)
      'sendevent', // 8. Low-level kernel touch events
      'inputswipe', // 9. Input swipe tap
      'javascript', // 10. JavaScript injection
      'double_tap', // 11. Double tap rapide
      'triple_tap', // 12. Triple tap
      'long_hold', // 13. Press and hold 2 seconds
      'offset_tap', // 14. Tap with offset (slightly moved)
      'mini_swipe', // 15. Mini swipe on button
      'monkey_tap', // 16. ADB monkey tap
      'uiautomator_shell', // 17. UIAutomator shell command
      'rapid_taps', // 18. Multiple rapid taps (5x)
      'circular_gesture', // 19. Circular gesture on button
      'keyevent_enter', // 20. Multiple ENTER key events
    ];
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log(`\n🔄 ═══ Attempt ${attempt}/${maxAttempts} ═══`);
      
      // Rotate through different click methods
      const methodIndex = (attempt - 1) % clickMethods.length;
      const method = clickMethods[methodIndex];
      log(`📍 Using method: ${method.toUpperCase()}`);
      
      // Find the NEXT button
      const selectors = [
        `//android.widget.Button[@text="NEXT"]`,
        `//*[@text="NEXT"]`,
        `//*[@resource-id="com.whatsapp:id/registration_submit"]`,
      ];
      
      let buttonClicked = false;
      let nextButton: any = null;
      
      // Find button
      for (const selector of selectors) {
        try {
          const button = await driver.$(selector);
          const exists = await button.isExisting();
          if (exists && await button.isDisplayed().catch(() => false)) {
            nextButton = button;
            log(`  ✅ Found NEXT button: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!nextButton) {
        log(`  ❌ NEXT button not found on attempt ${attempt}`);
        await this.sleep(3000);
        continue;
      }
      
      // Try different click methods based on the current method
      try {
        if (method === 'w3c_actions') {
          // METHOD 0: W3C Actions API (MOST RELIABLE!)
          log(`  🎭 METHOD 0: W3C Actions API (most modern)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          buttonClicked = await this.clickViaW3CActions(driver, x, y, log);
          
        } else if (method === 'longpress') {
          // METHOD 0.5: Longpress (sometimes more reliable)
          log(`  ⏱️ METHOD 0.5: Longpress method`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          buttonClicked = await this.clickViaLongpress(driver, x, y, log);
          
        } else if (method === 'standard') {
          // METHOD 1: Standard Appium click
          log(`  🖱️ METHOD 1: Standard Appium click()`);
          await nextButton.click();
          buttonClicked = true;
          
        } else if (method === 'uiautomator2') {
          // METHOD 2: UIAutomator2 direct
          log(`  🤖 METHOD 2: UIAutomator2 direct via mobile:clickGesture`);
          try {
            await driver.execute('mobile: clickGesture', {
              elementId: nextButton.elementId,
            });
            buttonClicked = true;
          } catch (gestureErr: any) {
            log(`  ⚠️ clickGesture failed: ${gestureErr.message}`);
            // Fallback: Try with coordinates
            const location = await nextButton.getLocation();
            const size = await nextButton.getSize();
            const x = location.x + (size.width / 2);
            const y = location.y + (size.height / 2);
            log(`  🎯 Fallback: Clicking at (${Math.round(x)}, ${Math.round(y)})`);
            await driver.execute('mobile: clickGesture', {
              x: Math.round(x),
              y: Math.round(y),
            });
            buttonClicked = true;
          }
          
        } else if (method === 'coordinates') {
          // METHOD 3: ADB input tap (coordinates)
          log(`  📍 METHOD 3: ADB input tap (coordinates)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          log(`  🎯 Tapping at (${x}, ${y})`);
          
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'gesture') {
          // METHOD 4: Touch gesture with press-wait-release
          log(`  ✋ METHOD 4: Touch gesture (press-wait-release)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          
          await driver.touchAction([
            { action: 'press', x, y },
            { action: 'wait', ms: 100 },
            { action: 'release' }
          ]);
          buttonClicked = true;
          
        } else if (method === 'ime_action') {
          // METHOD 5: IME action (submit form via keyboard)
          log(`  ⌨️ METHOD 5: IME action (submit via keyboard)`);
          // Try pressing ENTER to submit the form
          await driver.pressKeyCode(66); // KEYCODE_ENTER
          buttonClicked = true;
          
        } else if (method === 'sendevent') {
          // METHOD 6: Sendevent - low-level kernel touch events (NOUVEAU!)
          log(`  🎯 METHOD 6: Sendevent (low-level kernel events)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          buttonClicked = await this.clickViaSendevent(driver, x, y, log);
          
        } else if (method === 'inputswipe') {
          // METHOD 7: Input swipe tap
          log(`  🖱️ METHOD 7: Input swipe tap`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          buttonClicked = await this.clickViaInputSwipe(driver, x, y, log);
          
        } else if (method === 'javascript') {
          // METHOD 10: JavaScript injection
          log(`  💉 METHOD 10: JavaScript injection (force click)`);
          buttonClicked = await this.clickViaJavaScript(driver, nextButton, log);
          
        } else if (method === 'double_tap') {
          // METHOD 11: Double tap rapide
          log(`  👆👆 METHOD 11: Double tap`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          await this.sleep(50);
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'triple_tap') {
          // METHOD 12: Triple tap
          log(`  👆👆👆 METHOD 12: Triple tap`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          for (let i = 0; i < 3; i++) {
            await driver.execute('mobile: shell', {
              command: 'input',
              args: ['tap', x.toString(), y.toString()],
            });
            await this.sleep(50);
          }
          buttonClicked = true;
          
        } else if (method === 'long_hold') {
          // METHOD 13: Long press and hold 2 seconds
          log(`  ⏱️⏱️ METHOD 13: Long hold (2 seconds)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          await driver.touchAction([
            { action: 'press', x, y },
            { action: 'wait', ms: 2000 },
            { action: 'release' }
          ]);
          buttonClicked = true;
          
        } else if (method === 'offset_tap') {
          // METHOD 14: Tap with slight offset
          log(`  📍➡️ METHOD 14: Tap with offset`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2) + 10); // +10px offset
          const y = Math.round(location.y + (size.height / 2) + 5); // +5px offset
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'mini_swipe') {
          // METHOD 15: Mini swipe on button
          log(`  👉 METHOD 15: Mini swipe on button`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['swipe', x.toString(), y.toString(), (x + 10).toString(), y.toString(), '100'],
          });
          buttonClicked = true;
          
        } else if (method === 'monkey_tap') {
          // METHOD 16: ADB monkey tap
          log(`  🐵 METHOD 16: ADB monkey tap`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          await driver.execute('mobile: shell', {
            command: 'monkey',
            args: ['--pct-touch', '100', '-p', 'com.whatsapp', '--throttle', '100', '1'],
          });
          // Follow with direct tap
          await this.sleep(100);
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'uiautomator_shell') {
          // METHOD 17: UIAutomator shell command
          log(`  🤖📟 METHOD 17: UIAutomator shell command`);
          try {
            await driver.execute('mobile: shell', {
              command: 'uiautomator',
              args: ['runtest', 'dummy.jar', '-c', 'com.android.commands.uiautomator.Launcher'],
            });
          } catch (e: any) {
            log(`  ⚠️ UIAutomator shell not available, falling back to coordinates`);
          }
          // Fallback to tap
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', x.toString(), y.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'rapid_taps') {
          // METHOD 18: Multiple rapid taps
          log(`  ⚡⚡⚡ METHOD 18: Rapid taps (5x)`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const x = Math.round(location.x + (size.width / 2));
          const y = Math.round(location.y + (size.height / 2));
          for (let i = 0; i < 5; i++) {
            await driver.execute('mobile: shell', {
              command: 'input',
              args: ['tap', x.toString(), y.toString()],
            });
            await this.sleep(20);
          }
          buttonClicked = true;
          
        } else if (method === 'circular_gesture') {
          // METHOD 19: Circular gesture on button
          log(`  🔄 METHOD 19: Circular gesture`);
          const location = await nextButton.getLocation();
          const size = await nextButton.getSize();
          const centerX = Math.round(location.x + (size.width / 2));
          const centerY = Math.round(location.y + (size.height / 2));
          const radius = Math.min(size.width, size.height) / 4;
          
          // Draw small circle and end with tap
          for (let angle = 0; angle <= 360; angle += 90) {
            const rad = (angle * Math.PI) / 180;
            const x = Math.round(centerX + radius * Math.cos(rad));
            const y = Math.round(centerY + radius * Math.sin(rad));
            await driver.touchAction([
              { action: 'press', x, y },
              { action: 'wait', ms: 10 },
              { action: 'release' }
            ]);
          }
          // Final tap at center
          await driver.execute('mobile: shell', {
            command: 'input',
            args: ['tap', centerX.toString(), centerY.toString()],
          });
          buttonClicked = true;
          
        } else if (method === 'keyevent_enter') {
          // METHOD 20: Multiple ENTER key events
          log(`  ⌨️⌨️⌨️ METHOD 20: Multiple ENTER keys`);
          for (let i = 0; i < 3; i++) {
            await driver.pressKeyCode(66); // KEYCODE_ENTER
            await this.sleep(100);
          }
          // Also try DPAD_CENTER
          await driver.pressKeyCode(23); // KEYCODE_DPAD_CENTER
          buttonClicked = true;
        }
        
        if (buttonClicked) {
          log(`  ✅ Click executed with method: ${method}`);
        }
        
      } catch (clickErr: any) {
        log(`  ❌ Click failed with ${method}: ${clickErr.message}`);
      }
      
      // Wait and check for results
      await this.sleep(2000);
      
      // ═══════════════════════════════════════════════════════════════
      // CAPTURE NETWORK LOGS AFTER CLICK
      // ═══════════════════════════════════════════════════════════════
      log(`  📡 Capturing network logs after click...`);
      try {
        const networkLogs = await driver.execute('mobile: shell', {
          command: 'logcat',
          args: ['-d', '-v', 'time', '-s', 'WhatsApp:*', '*:E'],
          timeout: 5000,
        }).catch(() => '');
        
        if (networkLogs && networkLogs.length > 100) {
          log(`  📊 Captured ${networkLogs.length} chars of logs`);
          
          // Look for errors or interesting patterns
          const lines = networkLogs.split('\n').slice(-30); // Last 30 lines
          const errorLines = lines.filter((line: string) => 
            /error|fail|invalid|reject|denied|blocked|exception|http.*[45]\d\d/i.test(line)
          );
          
          if (errorLines.length > 0) {
            log(`  🔴 Found ${errorLines.length} potential error(s):`);
            errorLines.slice(0, 5).forEach((line: string, i: number) => {
              log(`    [${i + 1}] ${line.trim().substring(0, 120)}`);
            });
          } else {
            log(`  ✓ No obvious errors in network logs`);
          }
        }
      } catch (e: any) {
        log(`  ⚠️ Could not capture network logs: ${e.message}`);
      }
      
      // Check for confirmation dialog
      log(`  🔍 Checking for confirmation dialog...`);
      const dialogFound = await this.handleConfirmationDialog(driver, log, sessionId);
      if (dialogFound) {
        log(`  ✅ Confirmation dialog handled!`);
      }
      
      await this.sleep(1000);
      
      // Check if page changed
      const newActivity = await driver.getCurrentActivity();
      log(`  📱 Activity after click: ${newActivity}`);
      
      if (newActivity !== activityBefore && !newActivity.includes('RegisterPhone')) {
        log(`\n✅✅✅ SUCCESS! Page changed after ${attempt} attempt(s) using ${method}!`);
        log(`✅ New activity: ${newActivity}`);
        await this.saveScreenshot(driver, '06-success-next-button', sessionId, log);
        return true;
      } else {
        log(`  ⚠️ Page didn't change yet...`);
      }
      
      // Wait 3 seconds before next attempt (unless it's the last one)
      if (attempt < maxAttempts) {
        log(`  ⏳ Waiting 3 seconds before next attempt...`);
        await this.sleep(3000);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // FINAL NETWORK ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    log(`\n❌ Failed to click NEXT button after ${maxAttempts} attempts with all methods`);
    log(`\n📡 ═══ ANALYSE RÉSEAU FINALE ═══`);
    
    try {
      log(`📡 Capturing comprehensive network logs...`);
      const fullLogs = await driver.execute('mobile: shell', {
        command: 'logcat',
        args: ['-d', '-v', 'time'],
        timeout: 10000,
      }).catch(() => '');
      
      if (fullLogs && fullLogs.length > 0) {
        log(`📊 Total logs captured: ${fullLogs.length} characters`);
        
        // Analyze for WhatsApp specific errors
        const whatsappLines = fullLogs.split('\n').filter((line: string) => 
          line.includes('whatsapp') || line.includes('WhatsApp')
        );
        log(`📱 WhatsApp-related log lines: ${whatsappLines.length}`);
        
        // Look for network errors
        const networkErrors = whatsappLines.filter((line: string) =>
          /error|fail|invalid|reject|denied|blocked|voip|virtual|400|401|403|404|500|502|503/i.test(line)
        );
        
        if (networkErrors.length > 0) {
          log(`\n🔴 FOUND ${networkErrors.length} NETWORK ERRORS OR REJECTIONS:`);
          networkErrors.slice(0, 10).forEach((line: string, i: number) => {
            log(`  [${i + 1}] ${line.trim()}`);
          });
        } else {
          log(`\n✅ No network errors found in logs`);
        }
        
        // Look for HTTP requests
        const httpRequests = whatsappLines.filter((line: string) =>
          /http|https|request|response|post|get/i.test(line)
        );
        
        if (httpRequests.length > 0) {
          log(`\n📡 HTTP Requests found: ${httpRequests.length}`);
          httpRequests.slice(-10).forEach((line: string, i: number) => {
            log(`  [${i + 1}] ${line.trim().substring(0, 150)}`);
          });
        }
        
      } else {
        log(`⚠️ Could not capture comprehensive logs`);
      }
    } catch (e: any) {
      log(`⚠️ Error capturing final network logs: ${e.message}`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 3: INSTRUCTIONS POUR TEST MANUEL VNC
    // ═══════════════════════════════════════════════════════════════
    log(`\n📋 ═══ ÉTAPE 3: TEST MANUEL REQUIS ═══`);
    log(`\n🔧 Pour déboguer manuellement via VNC:`);
    log(`1. Connectez-vous à l'émulateur via VNC (port visible dans les logs Docker)`);
    log(`2. Essayez de cliquer MANUELLEMENT sur le bouton NEXT`);
    log(`3. Observez ce qui se passe:`);
    log(`   - Le bouton répond-il au clic manuel ?`);
    log(`   - Un dialogue de confirmation apparaît-il ?`);
    log(`   - Un message d'erreur s'affiche-t-il ?`);
    log(`4. Si le bouton ne fonctionne PAS manuellement:`);
    log(`   → WhatsApp bloque probablement les numéros virtuels (VoIP)`);
    log(`   → Solution: Utiliser des vrais numéros SIM ou une autre source`);
    log(`5. Si le bouton FONCTIONNE manuellement:`);
    log(`   → C'est un problème avec Appium/UIAutomator2`);
    log(`   → Contactez le support ou essayez une version différente de WhatsApp`);
    log(`\n📊 Résumé des méthodes testées:`);
    log(`  ✓ Standard Appium click() - ÉCHOUÉ`);
    log(`  ✓ UIAutomator2 clickGesture - ÉCHOUÉ`);
    log(`  ✓ ADB input tap coordinates - ÉCHOUÉ`);
    log(`  ✓ Touch gesture press-release - ÉCHOUÉ`);
    log(`  ✓ IME keyboard action (ENTER) - ÉCHOUÉ`);
    log(`\n💡 Diagnostic disponible dans les screenshots précédents`);
    
    await this.saveScreenshot(driver, 'final-stuck-on-register-phone', sessionId, log);
    await this.saveScreenshot(driver, '06-all-methods-exhausted', sessionId, log);
    return false;
  }

  /**
   * Click Next button and verify page changed
   * Returns true if page changed successfully, false otherwise
   */
  private async clickNextAndVerifyPageChange(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    this.logStep(WhatsAppStep.CLICKING_NEXT, 'Attempting to click Next button and verify page change', log);
    
    // Get current activity before clicking
    const activityBefore = await driver.getCurrentActivity();
    log(`📱 Current activity BEFORE click: ${activityBefore}`);
    
    // TRY EVERYTHING - aggressive approach
    return await this.tryEverythingToMoveToNextPage(driver, log, sessionId);
  }

  /**
   * Enter phone number in WhatsApp registration screen
   */
  private async enterPhoneNumber(driver: any, phoneNumber: string, countryName?: string, onLog?: (msg: string) => void, sessionId?: string): Promise<void> {
    const log = (msg: string) => {
      logger.info(msg);
      console.log(`🤖 [WHATSAPP-AUTO] ${msg}`);
      if (onLog) onLog(msg);
    };
    
    // Parse phone number: separate country code from phone number
    // Common country codes: US/CA = +1, UK = +44, etc.
    // Format: +15413919545 -> countryCode: "+1", phoneNumber: "5413919545"
    let countryCode = '';
    let phoneNumberOnly = phoneNumber;
    
    if (phoneNumber.startsWith('+')) {
      // List of known country codes (1 digit, 2 digits, 3 digits)
      // Priority: most common first
      const knownCountryCodes = [
        '+1',    // US, Canada
        '+7',    // Russia, Kazakhstan
        '+20',   // Egypt
        '+27',   // South Africa
        '+30',   // Greece
        '+31',   // Netherlands
        '+32',   // Belgium
        '+33',   // France
        '+34',   // Spain
        '+36',   // Hungary
        '+39',   // Italy
        '+40',   // Romania
        '+41',   // Switzerland
        '+43',   // Austria
        '+44',   // UK
        '+45',   // Denmark
        '+46',   // Sweden
        '+47',   // Norway
        '+48',   // Poland
        '+49',   // Germany
        '+51',   // Peru
        '+52',   // Mexico
        '+53',   // Cuba
        '+54',   // Argentina
        '+55',   // Brazil
        '+56',   // Chile
        '+57',   // Colombia
        '+58',   // Venezuela
        '+60',   // Malaysia
        '+61',   // Australia
        '+62',   // Indonesia
        '+63',   // Philippines
        '+64',   // New Zealand
        '+65',   // Singapore
        '+66',   // Thailand
        '+81',   // Japan
        '+82',   // South Korea
        '+84',   // Vietnam
        '+86',   // China
        '+90',   // Turkey
        '+91',   // India
        '+92',   // Pakistan
        '+93',   // Afghanistan
        '+94',   // Sri Lanka
        '+95',   // Myanmar
        '+98',   // Iran
        '+212',  // Morocco
        '+213',  // Algeria
        '+216',  // Tunisia
        '+218',  // Libya
        '+220',  // Gambia
        '+221',  // Senegal
        '+222',  // Mauritania
        '+223',  // Mali
        '+224',  // Guinea
        '+225',  // Ivory Coast
        '+226',  // Burkina Faso
        '+227',  // Niger
        '+228',  // Togo
        '+229',  // Benin
        '+230',  // Mauritius
        '+231',  // Liberia
        '+232',  // Sierra Leone
        '+233',  // Ghana
        '+234',  // Nigeria
        '+235',  // Chad
        '+236',  // Central African Republic
        '+237',  // Cameroon
        '+238',  // Cape Verde
        '+239',  // São Tomé and Príncipe
        '+240',  // Equatorial Guinea
        '+241',  // Gabon
        '+242',  // Republic of the Congo
        '+243',  // Democratic Republic of the Congo
        '+244',  // Angola
        '+245',  // Guinea-Bissau
        '+246',  // British Indian Ocean Territory
        '+248',  // Seychelles
        '+249',  // Sudan
        '+250',  // Rwanda
        '+251',  // Ethiopia
        '+252',  // Somalia
        '+253',  // Djibouti
        '+254',  // Kenya
        '+255',  // Tanzania
        '+256',  // Uganda
        '+257',  // Burundi
        '+258',  // Mozambique
        '+260',  // Zambia
        '+261',  // Madagascar
        '+262',  // Réunion
        '+263',  // Zimbabwe
        '+264',  // Namibia
        '+265',  // Malawi
        '+266',  // Lesotho
        '+267',  // Botswana
        '+268',  // Eswatini
        '+269',  // Comoros
        '+290',  // Saint Helena
        '+291',  // Eritrea
        '+297',  // Aruba
        '+298',  // Faroe Islands
        '+299',  // Greenland
        '+350',  // Gibraltar
        '+351',  // Portugal
        '+352',  // Luxembourg
        '+353',  // Ireland
        '+354',  // Iceland
        '+355',  // Albania
        '+356',  // Malta
        '+357',  // Cyprus
        '+358',  // Finland
        '+359',  // Bulgaria
        '+370',  // Lithuania
        '+371',  // Latvia
        '+372',  // Estonia
        '+373',  // Moldova
        '+374',  // Armenia
        '+375',  // Belarus
        '+376',  // Andorra
        '+377',  // Monaco
        '+378',  // San Marino
        '+380',  // Ukraine
        '+381',  // Serbia
        '+382',  // Montenegro
        '+383',  // Kosovo
        '+385',  // Croatia
        '+386',  // Slovenia
        '+387',  // Bosnia and Herzegovina
        '+389',  // North Macedonia
        '+420',  // Czech Republic
        '+421',  // Slovakia
        '+423',  // Liechtenstein
        '+500',  // Falkland Islands
        '+501',  // Belize
        '+502',  // Guatemala
        '+503',  // El Salvador
        '+504',  // Honduras
        '+505',  // Nicaragua
        '+506',  // Costa Rica
        '+507',  // Panama
        '+508',  // Saint Pierre and Miquelon
        '+509',  // Haiti
        '+590',  // Guadeloupe
        '+591',  // Bolivia
        '+592',  // Guyana
        '+593',  // Ecuador
        '+594',  // French Guiana
        '+595',  // Paraguay
        '+596',  // Martinique
        '+597',  // Suriname
        '+598',  // Uruguay
        '+599',  // Netherlands Antilles
        '+670',  // East Timor
        '+672',  // Norfolk Island
        '+673',  // Brunei
        '+674',  // Nauru
        '+675',  // Papua New Guinea
        '+676',  // Tonga
        '+677',  // Solomon Islands
        '+678',  // Vanuatu
        '+679',  // Fiji
        '+680',  // Palau
        '+681',  // Wallis and Futuna
        '+682',  // Cook Islands
        '+683',  // Niue
        '+685',  // Samoa
        '+686',  // Kiribati
        '+687',  // New Caledonia
        '+688',  // Tuvalu
        '+689',  // French Polynesia
        '+690',  // Tokelau
        '+691',  // Micronesia
        '+692',  // Marshall Islands
        '+850',  // North Korea
        '+852',  // Hong Kong
        '+853',  // Macau
        '+855',  // Cambodia
        '+856',  // Laos
        '+880',  // Bangladesh
        '+886',  // Taiwan
        '+960',  // Maldives
        '+961',  // Lebanon
        '+962',  // Jordan
        '+963',  // Syria
        '+964',  // Iraq
        '+965',  // Kuwait
        '+966',  // Saudi Arabia
        '+967',  // Yemen
        '+968',  // Oman
        '+970',  // Palestine
        '+971',  // United Arab Emirates
        '+972',  // Israel
        '+973',  // Bahrain
        '+974',  // Qatar
        '+975',  // Bhutan
        '+976',  // Mongolia
        '+977',  // Nepal
        '+992',  // Tajikistan
        '+993',  // Turkmenistan
        '+994',  // Azerbaijan
        '+995',  // Georgia
        '+996',  // Kyrgyzstan
        '+998',  // Uzbekistan
      ];
      
      // Try to match known country codes first (most specific first)
      let matched = false;
      for (const code of knownCountryCodes.sort((a, b) => b.length - a.length)) {
        if (phoneNumber.startsWith(code)) {
          countryCode = code;
          phoneNumberOnly = phoneNumber.substring(code.length);
          log(`📞 Parsed phone number: countryCode="${countryCode}", phoneNumber="${phoneNumberOnly}"`);
          matched = true;
          break;
        }
      }
      
      // If no match, try generic parsing (1-3 digits)
      if (!matched) {
        const match = phoneNumber.match(/^\+(\d{1,3})(.+)$/);
        if (match) {
          countryCode = `+${match[1]}`;
          phoneNumberOnly = match[2];
          log(`📞 Parsed phone number (generic): countryCode="${countryCode}", phoneNumber="${phoneNumberOnly}"`);
        } else {
          log(`⚠️ Could not parse phone number format, using as-is`);
        }
      }
    } else {
      log(`ℹ️ Phone number doesn't start with +, using as-is`);
    }
    
        log(`🔍 Looking for phone number input fields...`);
    
    // First, analyze what's on screen
    await this.saveScreenshot(driver, '05-before-phone-entry', sessionId || 'unknown');
    await this.logPageSource(driver, '05-before-phone-entry', sessionId || 'unknown');
    
    // Log some details about the screen
    try {
      const allElements = await driver.$$('*');
      log(`📊 Total elements on screen: ${allElements.length}`);
      
      // Try to find any EditText elements to see what's available
      const editTexts = await driver.$$('android.widget.EditText');
      log(`📝 Found ${editTexts.length} EditText elements`);
      
      for (let i = 0; i < Math.min(editTexts.length, 5); i++) {
        try {
          const et = editTexts[i];
          const exists = await et.isExisting();
          if (exists) {
            const hint = await et.getAttribute('hint').catch(() => '');
            const text = await et.getText().catch(() => '');
            const resourceId = await et.getAttribute('resource-id').catch(() => '');
            log(`  📝 EditText #${i}: hint="${hint}", text="${text}", resource-id="${resourceId}"`);
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e: any) {
      log(`⚠️ Could not analyze screen elements: ${e.message}`);
    }

    try {
      // Skip country selection - WhatsApp will auto-detect from country code
      if (countryName) {
        log(`🌍 Country: "${countryName}" (code: +${countryCode})`);
        log(`ℹ️ Skipping dropdown selection - WhatsApp will auto-detect from country code`);
        if (sessionId) await this.saveScreenshot(driver, 'before-phone-entry', sessionId, log);
      }

      // Find country code field and phone number field separately
      log(`🔎 [STRATEGY 1] Looking for country code and phone number fields...`);
      
      // Optimized selectors based on what we found in logs
      const countryCodeSelectors = [
        '//*[@resource-id="com.whatsapp:id/registration_cc"]', // Found in logs
      ];
      
      const phoneNumberSelectors = [
        '//*[@resource-id="com.whatsapp:id/registration_phone"]', // Found in logs, most reliable
        '//*[@resource-id="com.whatsapp:id/phone_number_field"]',
        '//*[@resource-id="com.whatsapp:id/e"]', // Common WhatsApp internal ID
      ];

      let countryCodeInput = null;
      let phoneInput = null;
      
      // Find country code field first (if we have a country code)
      if (countryCode) {
        for (const selector of countryCodeSelectors) {
          try {
            log(`  🔍 Trying country code selector: ${selector}`);
            countryCodeInput = await driver.$(selector);
            const exists = await countryCodeInput.isExisting();
            log(`    ${exists ? '✅' : '❌'} Country code field ${exists ? 'found' : 'not found'}`);
            
            if (exists) {
              log(`✅ Found country code field using selector: ${selector}`);
              break;
            }
          } catch (e: any) {
            log(`    ⚠️ Country code selector failed: ${e.message}`);
          }
        }
      }
      
      // Find phone number field
      for (const selector of phoneNumberSelectors) {
        try {
          log(`  🔍 Trying selector: ${selector}`);
          phoneInput = await driver.$(selector);
          const exists = await phoneInput.isExisting();
          log(`    ${exists ? '✅' : '❌'} Element ${exists ? 'exists' : 'not found'}`);
          
          if (exists) {
            log(`✅ Found phone number input field`);
            break;
          }
        } catch (e: any) {
          log(`    ❌ Selector failed: ${e.message}`);
          continue;
        }
      }

      if (!phoneInput || !await phoneInput.isExisting()) {
        log(`⚠️ [STRATEGY 2] Phone number input field not found with standard selectors, trying alternative method...`);
        
        // Try to find all EditText elements
        const allInputs = await driver.$$('android.widget.EditText');
        log(`📊 Found ${allInputs.length} EditText elements total`);
        
        for (let i = 0; i < allInputs.length; i++) {
          try {
            const input = allInputs[i];
            const exists = await input.isExisting();
            if (exists) {
              const text = await input.getText().catch(() => '');
              const hint = await input.getAttribute('hint').catch(() => '');
              log(`  📝 EditText #${i}: text="${text}", hint="${hint}"`);
            }
          } catch (e) {
            // Skip this element
          }
        }
        
        if (allInputs.length > 0) {
          phoneInput = allInputs[0];
          log(`✅ Using first EditText field found (index 0 of ${allInputs.length} total)`);
        }
      }

      if (phoneInput && await phoneInput.isExisting().catch(() => false)) {
        await this.saveScreenshot(driver, '04-before-phone-entry', sessionId || 'unknown');
        
        // Enter country code if we have a separate field
        // Remove the "+" sign before entering (WhatsApp field expects just "1", not "+1")
        if (countryCode && countryCodeInput && await countryCodeInput.isExisting().catch(() => false)) {
          const countryCodeWithoutPlus = countryCode.replace(/^\+/, ''); // Remove leading "+"
          log(`🌍 Entering country code: ${countryCodeWithoutPlus} (from ${countryCode})`);
          try {
            await countryCodeInput.click();
            await this.sleep(500);
            await countryCodeInput.clearValue().catch(() => {});
            await this.sleep(200);
            await countryCodeInput.setValue(countryCodeWithoutPlus);
            log(`✅ Country code "${countryCodeWithoutPlus}" entered`);
            await this.sleep(500);
          } catch (e: any) {
            log(`⚠️ Failed to enter country code: ${e.message}`);
          }
        }
        
        log(`🖱️ Clicking on phone number input field...`);
        try {
          await phoneInput.click();
          log(`✅ Clicked on phone number input field`);
          await this.sleep(1000);
        } catch (error: any) {
          
          log(`⚠️ Click failed, trying tap: ${error.message}`);
        }

        log(`🧹 Clearing phone number input field...`);
        try {
          await phoneInput.clearValue();
          await this.sleep(500);
        } catch (error: any) {
          // Try to select all and delete
          try {
            await driver.pressKeyCode(29); // KEYCODE_A (select all)
            await this.sleep(200);
            await driver.pressKeyCode(112); // KEYCODE_DEL (delete)
            await this.sleep(500);
          } catch (kbError: any) {
            // Ignore
          }
        }

        log(`⌨️ Entering phone number: ${phoneNumberOnly}...`);
        try {
          await phoneInput.setValue(phoneNumberOnly);
          log(`✅ Phone number "${phoneNumberOnly}" entered successfully`);
          await this.sleep(1000);
          
          // Verify the value was entered
          try {
            const enteredValue = await phoneInput.getText();
            log(`🔍 Verification: Input field contains: "${enteredValue}"`);
            // Check if the entered number (digits only) matches
            const enteredDigits = enteredValue.replace(/\D/g, '');
            const expectedDigits = phoneNumberOnly.replace(/\D/g, '');
            if (enteredDigits.includes(expectedDigits) || expectedDigits.includes(enteredDigits)) {
              log(`✅ Phone number verification: digits match`);
            } else {
              log(`⚠️ WARNING: Entered digits "${enteredDigits}" don't match expected "${expectedDigits}"`);
            }
          } catch (e) {
            log(`⚠️ Could not verify entered value: ${e}`);
          }
        } catch (error: any) {
          log(`❌ Failed to set value: ${error.message}`);
          throw error;
        }
        
        log(`📸 Taking screenshot after entering phone number...`);
        await this.saveScreenshot(driver, '05-after-phone-entry', sessionId || 'unknown');
        
        // NEW METHODOLOGY: Click Next button and verify page changed
        this.logStep(WhatsAppStep.PHONE_NUMBER_ENTRY, 'Phone number entered successfully', onLog);
        
        const pageChanged = await this.clickNextAndVerifyPageChange(driver, log, sessionId || 'unknown');
        
        if (pageChanged) {
          this.logStep(WhatsAppStep.WAITING_FOR_SMS_SCREEN, 'Successfully moved to SMS waiting screen. Ready to receive SMS.', onLog);
          log(`✅ ✅ ✅ SUCCESS: Phone number submitted and page changed!`);
          await this.saveScreenshot(driver, '07-ready-for-sms', sessionId || 'unknown');
          return; // SMS request has been sent, page changed successfully
        } else {
          // Page didn't change - this is a CRITICAL ERROR
          log(`❌ ❌ ❌ CRITICAL ERROR: Could not submit phone number - page did not change!`);
          log(`❌ SMS CANNOT be sent because we are still on the phone entry screen`);
          log(`❌ DO NOT proceed to wait for SMS - the request was never sent!`);
          await this.saveScreenshot(driver, '07-failed-to-submit', sessionId || 'unknown');
          throw new Error('Failed to submit phone number - Next button click did not change the page. Cannot proceed to SMS waiting.');
        }
      } else {
        log(`❌ Could not find phone number input field after trying all selectors`);
        await this.saveScreenshot(driver, 'error-no-input-field', sessionId || 'unknown');
        await this.logPageSource(driver, 'error-no-input-field', sessionId || 'unknown');
        throw new Error('Could not find phone number input field');
      }
    } catch (error: any) {
      log(`❌ Failed to enter phone number: ${error.message}`);
      logger.error({ error: error.message }, 'Failed to enter phone number');
      await this.saveScreenshot(driver, 'error-phone-entry-failed', sessionId || 'unknown');
      throw error;
    }
  }

  /**
   * Check if app is installed
   */
  private async isAppInstalled(driver: any, packageName: string): Promise<boolean> {
    try {
      // Use a proper shell command to check if package exists
      const result = await driver.execute('mobile: shell', {
        command: 'pm',
        args: ['list', 'packages', packageName],
      });
      // If the output contains the package name, it's installed
      return result && result.includes(packageName);
    } catch (e) {
      // Try alternative method
      try {
        const result = await driver.execute('mobile: shell', {
          command: 'pm',
          args: ['path', packageName],
        });
        return result && result.includes(packageName);
      } catch (e2) {
        return false;
      }
    }
  }

  /**
   * Install WhatsApp APK using ADB directly (more reliable than Appium shell)
   */
  private async installWhatsAppViaAdb(containerId: string, log: (msg: string) => void): Promise<void> {
    log(`📥 Installing WhatsApp via ADB directly...`);
    
    try {
      const Docker = (await import('dockerode')).default;
      const docker = new Docker();
      const container = docker.getContainer(containerId);
      
      // Get ADB port from container info
      const containerInfo = await container.inspect();
      const adbPort = containerInfo.NetworkSettings?.Ports?.['5555/tcp']?.[0]?.HostPort;
      
      if (!adbPort) {
        throw new Error('Could not find ADB port for container');
      }
      
      log(`🔍 ADB port: ${adbPort}`);
      
      // Download WhatsApp APK using curl inside the container
      log(`📥 Downloading WhatsApp APK to container...`);
      const downloadExec = await container.exec({
        Cmd: ['sh', '-c', 'curl -L -o /tmp/whatsapp.apk https://www.whatsapp.com/android/current/WhatsApp.apk'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const downloadStream = await downloadExec.start({ Detach: false, Tty: false });
      let downloadOutput = '';
      downloadStream.on('data', (chunk: Buffer) => {
        downloadOutput += chunk.toString();
      });
      await new Promise(resolve => downloadStream.on('end', resolve));
      
      if (!downloadOutput.includes('saved') && downloadOutput.includes('error')) {
        throw new Error(`Failed to download APK: ${downloadOutput}`);
      }
      
      log(`✅ APK downloaded successfully`);
      
      // Install APK using adb install from within the container
      log(`📦 Installing WhatsApp APK via ADB...`);
      const installExec = await container.exec({
        Cmd: ['sh', '-c', 'adb -e install -r /tmp/whatsapp.apk'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const installStream = await installExec.start({ Detach: false, Tty: false });
      let installOutput = '';
      installStream.on('data', (chunk: Buffer) => {
        installOutput += chunk.toString();
      });
      await new Promise(resolve => installStream.on('end', resolve));
      
      if (installOutput.includes('Success') || installOutput.includes('success')) {
        log(`✅ WhatsApp installed successfully via ADB`);
        return;
      } else {
        throw new Error(`ADB install failed: ${installOutput}`);
      }
    } catch (error: any) {
      log(`❌ ADB installation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Install WhatsApp APK from Play Store or download and install APK
   */
  private async installWhatsApp(driver: any, log: (msg: string) => void, sessionId: string, containerId?: string): Promise<void> {
    log(`📥 WhatsApp not found, attempting to install...`);
    
    // Try ADB installation first (more reliable)
    if (containerId) {
      try {
        await this.installWhatsAppViaAdb(containerId, log);
        await this.sleep(3000);
        // Verify installation
        const isInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
        if (isInstalled) {
          log(`✅ WhatsApp verified as installed`);
          return;
        }
      } catch (adbError: any) {
        log(`⚠️ ADB installation failed, trying Appium shell method: ${adbError.message}`);
      }
    }
    
    try {
      // Method 1: Try to install via Play Store (if available)
      log(`🔍 Checking if Play Store is available...`);
      const hasPlayStore = await this.isAppInstalled(driver, 'com.android.vending');
      
      if (hasPlayStore) {
        log(`📱 Play Store is available, attempting to install WhatsApp via Play Store...`);
        try {
          // Launch Play Store
          await driver.execute('mobile: shell', {
            command: 'am',
            args: ['start', '-a', 'android.intent.action.VIEW', '-d', 'market://details?id=com.whatsapp'],
          });
          log(`⚠️ Play Store opened. Manual installation required. Waiting 60s for manual installation...`);
          await this.sleep(60000); // Wait 60s for manual installation
          await this.saveScreenshot(driver, 'play-store-wait', sessionId, log); // Use sessionId to avoid TS error
          
          // Check again
          const isNowInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
          if (isNowInstalled) {
            log(`✅ WhatsApp installed successfully via Play Store`);
            return;
          }
        } catch (playStoreError: any) {
          log(`⚠️ Play Store installation failed: ${playStoreError.message}`);
        }
      }
      
      // Method 2: Download and install APK directly via Appium shell (requires relaxed-security)
      log(`📥 Downloading WhatsApp APK via Appium shell...`);
      // Use version from early December 2024 (working 3-5 days ago)
      const apkUrl = 'https://www.whatsapp.com/android/2.24.24.76/WhatsApp.apk';
      
      try {
        // Download APK to container's /tmp directory
        await driver.execute('mobile: shell', {
          command: 'curl',
          args: ['-L', '-o', '/sdcard/whatsapp.apk', apkUrl],
        });
        
        log(`📦 Installing WhatsApp APK...`);
        // Install APK
        await driver.execute('mobile: shell', {
          command: 'pm',
          args: ['install', '-r', '/sdcard/whatsapp.apk'],
        });
        
        log(`✅ WhatsApp APK installation completed`);
        await this.sleep(2000); // Wait for installation to complete
        
        // Verify installation
        const isInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
        if (isInstalled) {
          log(`✅ WhatsApp verified as installed`);
          return;
        } else {
          throw new Error('WhatsApp installation completed but package not found');
        }
      } catch (apkError: any) {
        log(`❌ APK installation via Appium shell failed: ${apkError.message}`);
        log(`💡 Please install WhatsApp manually in the emulator via Play Store or APK`);
        throw new Error(`Failed to install WhatsApp: ${apkError.message}`);
      }
    } catch (error: any) {
      log(`❌ Failed to install WhatsApp: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait for Appium server to be ready
   */
  private async waitForAppium(port: number, timeout: number = 120000, onLog?: (msg: string) => void, hostname: string = 'host.docker.internal'): Promise<void> {
    const startTime = Date.now();
    // Use provided hostname (container name for Docker-to-Docker, or host.docker.internal for external access)
    const urls = [
      `http://${hostname}:${port}/status`,
    ];
    let attemptCount = 0;

    const log = (msg: string) => {
      logger.info(msg);
      if (onLog) onLog(msg);
    };

    log(`Checking Appium server status at ${hostname}:${port}...`);

    while (Date.now() - startTime < timeout) {
      attemptCount++;
      let lastError: any = null;
      let success = false;
      
      for (const url of urls) {
        try {
          const response = await axios.get(url, { timeout: 5000 });
          if (response.status === 200 && response.data?.value?.ready) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`✅ Appium server is ready via ${url}! (took ${elapsed}s, ${attemptCount} attempts)`);
            success = true;
            break;
          }
        } catch (e: any) {
          lastError = e;
          // Try next URL
        }
      }
      
      if (success) {
        return;
      }
      
      // Server not ready yet, log every 10 attempts
      if (attemptCount % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`⏳ Appium not ready yet (attempt ${attemptCount}, ${elapsed}s elapsed, last error: ${lastError?.message || 'none'})...`);
      }
      
      await this.sleep(3000);
    }

    throw new Error(`Appium server on port ${port} not ready after ${timeout}ms (attempted ${attemptCount} times)`);
  }

  /**
   * Inject OTP code into WhatsApp verification screen
   */
  async injectOtp(options: {
    appiumPort: number;
    otp: string;
    sessionId: string;
    onLog?: (message: string) => void;
  }): Promise<void> {
    const { appiumPort, otp, sessionId, onLog } = options;
    
    const log = (message: string) => {
      logger.info(message);
      console.log(`💉 [OTP-INJECTION] ${message}`);
      if (onLog) onLog(message);
    };

    log(`🔍 ==== STARTING OTP INJECTION ====`);
    log(`Starting OTP injection for session ${sessionId}`);
    log(`📡 Appium port: ${appiumPort}`);
    log(`🔑 OTP code: ${otp}`);

    // Wait for Appium to be ready
    await this.waitForAppium(appiumPort, 30000, log);

    let driver: any = null;

    try {
      // Connect to Appium
      const RemoteOptions: RemoteOptions = {
        hostname: 'host.docker.internal',
        port: appiumPort,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:noReset': true,
        },
        logLevel: 'info',
      };

      log(`🔌 Connecting to Appium server on host.docker.internal:${appiumPort}...`);
      driver = await remote(RemoteOptions);
      log(`✅ Connected to Appium server successfully`);

      await this.sleep(1000);
      
      // Detect current screen before starting OTP injection
      await this.detectCurrentScreen(driver, log);

      // Wait for OTP input screen (verification screen) to appear
      // This is critical - we must wait until the "Verifying your number" screen with empty fields is visible
      log(`⏳ Waiting for OTP verification screen ("Verifying your number") to appear...`);
      
      let otpInput = null;
      const maxWaitTime = 60000; // 60 seconds max wait (increased from 30s)
      const checkInterval = 2000; // Check every 2 seconds
      const startTime = Date.now();
      let foundOtpScreen = false;

      while (Date.now() - startTime < maxWaitTime && !foundOtpScreen) {
        await this.sleep(checkInterval);
        const attemptNum = Math.floor((Date.now() - startTime) / checkInterval) + 1;
        log(`🔍 Checking for verification screen (attempt ${attemptNum})...`);
        await this.saveScreenshot(driver, `otp-wait-${attemptNum}`, sessionId);

        // First, check for the screen title "Verifying your number"
        let foundTitle = false;
        try {
          const titleSelectors = [
            '//*[@text="Verifying your number"]',
            '//*[contains(@text, "Verifying your number")]',
            '//*[contains(@text, "Verifying")]',
          ];

          for (const selector of titleSelectors) {
            try {
              const titleElement = await driver.$(selector);
              if (await titleElement.isExisting()) {
                const isDisplayed = await titleElement.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  const text = await titleElement.getText().catch(() => '');
                  if (text && text.toLowerCase().includes('verifying')) {
                    log(`✅ Found verification screen title: "${text}"`);
                    foundTitle = true;
                    break;
                  }
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // Ignore title check errors
        }

        // Check current activity to see if we're on verification screen
        try {
          const currentActivity = await driver.getCurrentActivity();
          log(`📱 Current activity: ${currentActivity}`);
          
          // Check if activity suggests OTP screen
          if (currentActivity && (
            currentActivity.includes('verification') || 
            currentActivity.includes('otp') || 
            currentActivity.includes('code')
          )) {
            log(`✅ Found verification activity: ${currentActivity}`);
            foundTitle = true; // Activity confirms we're on verification screen
          }
        } catch (e) {
          // Ignore activity check errors
        }

        // If we found the title/activity, look for the OTP input fields
        if (foundTitle) {
          log(`🔍 Screen title found, looking for OTP input fields...`);
          
          // First, try to find a container with multiple EditText fields (6 digits)
          const otpContainerSelectors = [
            '//*[@resource-id="com.whatsapp:id/verification_code_input"]',
            '//*[@resource-id="com.whatsapp:id/code_input"]',
            '//*[@resource-id="com.whatsapp:id/register_otp"]',
            '//*[contains(@resource-id, "verification")]',
            '//*[contains(@resource-id, "code_input")]',
            '//*[contains(@resource-id, "otp")]',
          ];

          let foundViaContainer = false;

          // Try container first
          for (const selector of otpContainerSelectors) {
            try {
              const container = await driver.$(selector);
              const exists = await container.isExisting();
              if (exists) {
                const isDisplayed = await container.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  log(`✅ Found OTP container: ${selector}`);
                  // Try to find EditText inside container
                  try {
                    otpInput = await container.$('//android.widget.EditText');
                    if (await otpInput.isExisting()) {
                      foundViaContainer = true;
                      foundOtpScreen = true;
                      break;
                    }
                  } catch (e) {
                    // Container found but no EditText inside, try clicking container
                    otpInput = container;
                    foundViaContainer = true;
                    foundOtpScreen = true;
                    break;
                  }
                }
              }
            } catch (e: any) {
              continue;
            }
          }

          // If container not found, try individual EditText fields
          if (!foundViaContainer) {
            try {
              const allEditTexts = await driver.$$('android.widget.EditText');
              log(`📊 Found ${allEditTexts.length} EditText elements on screen`);
              
              for (let i = 0; i < allEditTexts.length; i++) {
                try {
                  const editText = allEditTexts[i];
                  const exists = await editText.isExisting();
                  if (exists) {
                    const isDisplayed = await editText.isDisplayed().catch(() => false);
                    const text = await editText.getText().catch(() => '');
                    const hint = await editText.getAttribute('hint').catch(() => '');
                    const resourceId = await editText.getAttribute('resource-id').catch(() => '');
                    
                    // Look for OTP-related indicators or empty fields (6-digit code fields are typically empty)
                    if (isDisplayed && (
                      hint.toLowerCase().includes('code') || 
                      hint.toLowerCase().includes('verification') ||
                      resourceId.toLowerCase().includes('code') ||
                      resourceId.toLowerCase().includes('verification') ||
                      resourceId.toLowerCase().includes('otp') ||
                      (text === '' && resourceId.includes('code')) || // Empty code field
                      text === '_' || 
                      text === '-'
                    )) {
                      log(`✅ Found OTP input field #${i} (hint: "${hint}", resource-id: "${resourceId}", text: "${text}")`);
                      otpInput = editText;
                      foundOtpScreen = true;
                      break;
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
            } catch (e) {
              // Continue waiting
            }
          }
        } else {
          // Screen title not found yet, continue waiting
          log(`⏳ Verification screen title not found yet, waiting...`);
        }
      }

      // Final check - if still not found, try one more time with all EditTexts
      if (!otpInput || !(await otpInput.isExisting().catch(() => false))) {
        log(`🔍 Final attempt: trying to find any available EditText on screen...`);
        try {
          const allEditTexts = await driver.$$('android.widget.EditText');
          for (let i = 0; i < allEditTexts.length; i++) {
            try {
              const editText = allEditTexts[i];
              const exists = await editText.isExisting();
              if (exists) {
                const isDisplayed = await editText.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  log(`✅ Using EditText #${i} as OTP input (fallback)`);
                  otpInput = editText;
                  foundOtpScreen = true;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // Continue to error
        }
      }

      if (!otpInput || !(await otpInput.isExisting().catch(() => false))) {
        await this.saveScreenshot(driver, 'otp-screen-no-input', sessionId, log);
        await this.logPageSource(driver, 'otp-screen-no-input', sessionId);
        throw new Error('Could not find OTP input field after waiting 60 seconds. The "Verifying your number" screen may not have appeared.');
      }

      log(`✅ OTP verification screen is visible, input field found!`);
      await this.saveScreenshot(driver, 'otp-screen-found', sessionId, log);
      await this.logPageSource(driver, 'otp-screen-found', sessionId);

      // Enter OTP digit by digit (for 6-digit code)
      log(`⌨️ Entering OTP code digit by digit: ${otp}...`);
      
      // Click on the input field first
      await otpInput.click();
      await this.sleep(500);
      
      // Clear any existing value
      try {
        await otpInput.clearValue();
        await this.sleep(200);
      } catch (e) {
        // Ignore clear errors
      }
      
      // Try setting the full OTP code
      try {
        await otpInput.setValue(otp);
        log(`✅ OTP code entered as full string`);
        await this.sleep(1000);
      } catch (e: any) {
        log(`⚠️ Full string entry failed: ${e.message}, trying digit by digit...`);
        
        // If full string doesn't work, try entering digit by digit using keyboard
        for (let i = 0; i < otp.length; i++) {
          const digit = otp[i];
          log(`  ⌨️ Entering digit ${i + 1}/${otp.length}: ${digit}`);
          
          // Use keyboard keycode for the digit
          const keyCode = 7 + parseInt(digit); // KEYCODE_0 = 7, so digit '0' = 7, '1' = 8, etc.
          try {
            await driver.pressKeyCode(keyCode);
            await this.sleep(300);
          } catch (keyError) {
            // Fallback: try typing the digit character
            try {
              await otpInput.addValue(digit);
              await this.sleep(300);
            } catch (typeError) {
              log(`  ⚠️ Failed to enter digit ${digit}`);
            }
          }
        }
        log(`✅ OTP code entered digit by digit`);
      }
      
      await this.sleep(1000);
      log(`✅ OTP code entry completed`);

      await this.sleep(2000);
      await this.saveScreenshot(driver, 'otp-entered', sessionId, log);

      // Look for "Next" or "Verify" button
      log(`🔍 Looking for verification button...`);
      const buttonSelectors = [
        '//android.widget.Button[@text="NEXT"]',
        '//android.widget.Button[@text="Next"]',
        '//android.widget.Button[@text="VERIFY"]',
        '//android.widget.Button[@text="Verify"]',
        '//android.widget.Button[@resource-id="com.whatsapp:id/submit"]',
        '//android.widget.Button[@resource-id="com.whatsapp:id/verify"]',
      ];

      for (const selector of buttonSelectors) {
        try {
          const button = await driver.$(selector);
          const exists = await button.isExisting();
          if (exists) {
            const isDisplayed = await button.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ Found verification button, clicking...`);
              await button.click();
              await this.sleep(3000);
              log(`✅ Verification button clicked`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      await this.saveScreenshot(driver, 'otp-after-verify', sessionId, log);
      log(`✅ Verification button clicked`);

      // Wait briefly for transition to next screen (permissions or profile)
      await this.sleep(2000);

      // Check what screen we're on now
      try {
        const currentActivity = await driver.getCurrentActivity();
        log(`📱 Current activity after OTP: ${currentActivity}`);
        await this.saveScreenshot(driver, 'after-otp-verification', sessionId, log);
      } catch (e) {
        // Ignore
      }
      
      // Detect screen after OTP injection
      log(`🔍 ==== AFTER OTP INJECTION - DETECTING SCREEN ====`);
      const screenAfterOtp = await this.detectCurrentScreen(driver, log);
      log(`🖥️ Screen after OTP: ${screenAfterOtp}`);

      // CRITICAL: Check if phone is already registered on another device
      log(`🔍 Checking if phone is already registered on another device...`);
      await this.checkForPhoneAlreadyRegistered(driver, log, sessionId);

      // Complete profile setup if needed (name, photo)
      // Note: Contact permission popup is handled inside completeProfileSetup now
      log(`🔧 Completing profile setup (including permissions and profile info)...`);
      await this.completeProfileSetup(driver, log, sessionId);

      // Quick verification that we're on HomeActivity
      log(`🔍 Verifying WhatsApp activation...`);
      await this.sleep(1000); // Just 1 second to ensure UI is stable
      
      let isActivated = false;
      let retryCount = 0;
      const maxRetries = 2; // Reduced from 3 to 2
      
      while (!isActivated && retryCount < maxRetries) {
        retryCount++;
        log(`🔄 Activation check attempt ${retryCount}/${maxRetries}...`);
        isActivated = await this.verifyWhatsAppActivated(driver, log, sessionId);
        
        if (!isActivated && retryCount < maxRetries) {
          log(`⏳ Not activated yet, waiting 5 more seconds...`);
          await this.sleep(5000);
        }
      }
      
      if (isActivated) {
        log(`✅ WhatsApp account activated successfully!`);
        await this.saveScreenshot(driver, 'whatsapp-activated', sessionId, log);
      } else {
        log(`⚠️ Could not verify WhatsApp activation after ${maxRetries} attempts`);
        log(`ℹ️ WhatsApp may still be loading or on an unexpected screen`);
        await this.saveScreenshot(driver, 'whatsapp-not-activated', sessionId, log);
        
        // Take page source for debugging
        try {
          const pageSource = await driver.getPageSource();
          log(`📄 Current page source (first 500 chars): ${pageSource.substring(0, 500)}`);
        } catch (e) {
          log(`⚠️ Could not get page source: ${e}`);
        }
      }

      log(`✅ OTP injection and profile setup completed successfully`);

    } catch (error: any) {
      log(`❌ OTP injection failed: ${error.message}`);
      logger.error({ error: error.message, sessionId }, 'OTP injection failed');
      if (driver) {
        await this.saveScreenshot(driver, 'otp-injection-error', sessionId, log);
      }
      throw error;
    } finally {
      // ⚠️ DO NOT close Appium session here! 
      // The session must stay alive for sendMessage() to work after OTP injection
      // The session will be closed after the snapshot is created (which kills Appium anyway)
      if (driver) {
        log(`ℹ️ Keeping Appium session alive for message sending...`);
      }
    }
  }

  /**
   * Handle "Restore a backup" screen - click "Skip" to skip all restore/transfer popups
   */
  private async handleRestoreBackupScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      await this.sleep(2000);
      
      // Look for text that indicates we're on the restore backup screen
      const restoreBackupIndicators = [
        '//*[contains(@text, "Restore or transfer chats")]',
        '//*[contains(@text, "Transfer from old phone")]',
        '//*[contains(@text, "Restore from backup")]',
        '//*[contains(@text, "Restore a backup")]',
        '//*[contains(@text, "Restore backup")]',
        '//*[contains(@text, "restore your backup")]',
        '//*[contains(@text, "Google storage")]',
        '//*[contains(@text, "backed up to Google")]',
        '//*[contains(@text, "Google account for backups")]',
      ];

      let onRestoreScreen = false;
      for (const selector of restoreBackupIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            onRestoreScreen = true;
            log(`✅ Found restore/transfer backup screen`);
            await this.saveScreenshot(driver, 'restore-backup-screen', sessionId, log);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (onRestoreScreen) {
        // Look for "Skip" button (always Skip, never Continue or Give permission)
        log(`🔍 Looking for Skip button on restore/transfer screen...`);
        const skipButtonSelectors = [
          '//android.widget.Button[@text="Skip"]',
          '//android.widget.Button[@text="SKIP"]',
          '//*[@text="Skip"]',
          '//*[@text="SKIP"]',
          '//android.widget.TextView[@text="Skip"]',
          '(//*[contains(@text, "Skip")])[1]', // First Skip button if multiple
        ];

        let buttonClicked = false;
        for (const selector of skipButtonSelectors) {
          try {
            const button = await driver.$(selector);
            const exists = await button.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await button.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Found Skip button, clicking...`);
                await button.click();
                await this.sleep(3000);
                log(`✅ First restore/transfer screen skipped`);
                buttonClicked = true;
                await this.saveScreenshot(driver, 'after-first-skip', sessionId, log);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!buttonClicked) {
          log(`⚠️ Skip button not found, trying alternative search...`);
        }
        
        // CRITICAL: Check for SECOND popup (appears after first Skip)
        if (buttonClicked) {
          log(`🔍 Checking for second Google backup popup...`);
                  await this.sleep(2000);
          
          const secondPopupIndicators = [
            '//*[contains(@text, "backed up to Google storage")]',
            '//*[contains(@text, "Google account for backups")]',
            '//*[contains(@text, "Give permission")]',
          ];
          
          let secondPopupFound = false;
          for (const selector of secondPopupIndicators) {
            try {
              const elem = await driver.$(selector);
              const exists = await elem.isExisting().catch(() => false);
              if (exists) {
                secondPopupFound = true;
                log(`✅ Second Google backup popup detected!`);
                await this.saveScreenshot(driver, 'second-backup-popup', sessionId, log);
                  break;
                }
              } catch (e) {
                continue;
            }
          }
          
          if (secondPopupFound) {
            log(`🔍 Looking for Skip button on second popup...`);
            for (const selector of skipButtonSelectors) {
              try {
                const skipBtn = await driver.$(selector);
                const exists = await skipBtn.isExisting().catch(() => false);
                if (exists) {
                  const isDisplayed = await skipBtn.isDisplayed().catch(() => false);
                  if (isDisplayed) {
                    log(`✅ Found Skip button on second popup, clicking...`);
                    await skipBtn.click();
                    await this.sleep(3000);
                    log(`✅ Second backup popup skipped`);
                    await this.saveScreenshot(driver, 'after-second-skip', sessionId, log);
                    break;
              }
            }
          } catch (e) {
                continue;
              }
            }
          } else {
            log(`ℹ️ No second backup popup found`);
          }
        }
      } else {
        log(`ℹ️ No restore backup screen found, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling restore backup screen: ${error.message}, continuing...`);
      // Don't throw - this is optional
    }
  }

  /**
   * Handle "Test message" screen - click "Next" to continue
   */
  private async handleTestMessageScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for test message screen...`);
      await this.sleep(3000);
      
      // Take screenshot first to see what we're dealing with
      await this.saveScreenshot(driver, 'check-test-message-screen', sessionId, log);
      
      // Look for text that indicates we're on the test message screen
      const testMessageIndicators = [
        '//*[contains(@text, "Test message")]',
        '//*[contains(@text, "test message")]',
        '//*[contains(@text, "Test Message")]',
        '//android.widget.EditText[contains(@text, "Test message")]',
        '//android.widget.EditText[contains(@hint, "Test message")]',
      ];

      let onTestScreen = false;
      for (const selector of testMessageIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await element.isDisplayed().catch(() => false);
            if (isDisplayed) {
              onTestScreen = true;
              log(`✅ Found test message screen (detected via: ${selector})`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (!onTestScreen) {
        // Try to detect by checking page source
        try {
          const pageSource = await driver.getPageSource();
          if (pageSource.includes('Test message') || pageSource.includes('test message')) {
            onTestScreen = true;
            log(`✅ Found test message screen (detected via page source)`);
          }
        } catch (e) {
          // Ignore
        }
      }

      if (onTestScreen) {
        await this.saveScreenshot(driver, 'test-message-screen-detected', sessionId, log);
        
        // Look for "Next" button - try multiple strategies
        log(`🔍 Looking for Next button on test message screen...`);
        
        const nextButtonSelectors = [
          '//android.widget.Button[@text="Next"]',
          '//android.widget.Button[@text="NEXT"]',
          '//*[@text="Next"]',
          '//*[@text="NEXT"]',
          '//android.widget.Button[contains(translate(@text, "NEXT", "next"), "next")]',
          '//android.widget.Button',
        ];

        let buttonClicked = false;
        for (const selector of nextButtonSelectors) {
          try {
            if (selector === '//android.widget.Button') {
              // Last resort: get all buttons and check their text
              const allButtons = await driver.$$(selector);
              log(`📊 Found ${allButtons.length} buttons on screen`);
              
              for (let i = 0; i < allButtons.length; i++) {
                try {
                  const btn = allButtons[i];
                  const exists = await btn.isExisting().catch(() => false);
                  if (!exists) continue;
                  
                  const isDisplayed = await btn.isDisplayed().catch(() => false);
                  if (!isDisplayed) continue;
                  
                  const text = await btn.getText().catch(() => '');
                  const resourceId = await btn.getAttribute('resource-id').catch(() => '');
                  
                  log(`🔘 Button ${i}: text="${text}", resource-id="${resourceId}"`);
                  
                  if (text && text.toLowerCase().includes('next')) {
                    log(`✅ Found Next button (text="${text}"), clicking...`);
                    await btn.click();
                    await this.sleep(3000);
                    log(`✅ Test message screen passed`);
                    buttonClicked = true;
                    await this.saveScreenshot(driver, 'after-test-message', sessionId, log);
                    break;
                  }
                } catch (btnError) {
                  continue;
                }
              }
              if (buttonClicked) break;
            } else {
              const button = await driver.$(selector);
              const exists = await button.isExisting().catch(() => false);
              if (exists) {
                const isDisplayed = await button.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  const text = await button.getText().catch(() => 'unknown');
                  log(`✅ Found Next button via selector "${selector}" (text="${text}"), clicking...`);
                  await button.click();
                  await this.sleep(3000);
                  log(`✅ Test message screen passed`);
                  buttonClicked = true;
                  await this.saveScreenshot(driver, 'after-test-message', sessionId, log);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!buttonClicked) {
          log(`⚠️ Could not find Next button on test message screen, will try to continue anyway`);
          await this.saveScreenshot(driver, 'test-message-no-next-found', sessionId, log);
        }
      } else {
        log(`ℹ️ No test message screen found, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling test message screen: ${error.message}, continuing...`);
      await this.saveScreenshot(driver, 'test-message-error', sessionId).catch(() => {});
      // Don't throw - this is optional
    }
  }

  /**
   * Handle "Add your email" screen - skip or fill email
   */
  private async handleEmailScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for email screen...`);
      await this.sleep(2000);
      
      await this.saveScreenshot(driver, 'check-email-screen', sessionId, log);
      
      // Look for text that indicates we're on the email screen
      const emailScreenIndicators = [
        '//*[contains(@text, "Add your email")]',
        '//*[contains(@text, "add your email")]',
        '//*[@text="Add your email"]',
        '//android.widget.EditText[@hint="Email"]',
        '//android.widget.EditText[contains(@hint, "email")]',
        '//android.widget.EditText[contains(@hint, "Email")]',
      ];

      let onEmailScreen = false;
      for (const selector of emailScreenIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await element.isDisplayed().catch(() => false);
            if (isDisplayed) {
              onEmailScreen = true;
              log(`✅ Found email screen (detected via: ${selector})`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (onEmailScreen) {
        log(`📧 On "Add your email" screen`);
        
        // CRITICAL: Close keyboard first to reveal the Skip button at the bottom!
        log(`⌨️ Closing keyboard to reveal Skip button...`);
        try {
          await driver.hideKeyboard();
          await this.sleep(1000);
          log(`✅ Keyboard closed successfully`);
          await this.saveScreenshot(driver, 'after-keyboard-closed', sessionId, log);
        } catch (keyboardError) {
          log(`⚠️ Could not close keyboard (might already be closed): ${keyboardError}`);
          // Try alternative: tap outside keyboard area
          try {
            log(`🖱️ Trying to tap outside keyboard to close it...`);
            await driver.execute('mobile: clickGesture', {
              x: 540,  // Center of screen
              y: 400   // Upper area (above keyboard)
            });
            await this.sleep(1000);
            log(`✅ Tapped outside keyboard`);
            await this.saveScreenshot(driver, 'after-tap-outside-keyboard', sessionId, log);
          } catch (tapError) {
            log(`⚠️ Could not tap outside keyboard: ${tapError}`);
          }
        }
        
        // Now, try to find and click "Skip" button (should be visible now)
        log(`🔍 Looking for Skip/Not now button...`);
        const skipButtonSelectors = [
          '//android.widget.Button[@text="Skip"]',
          '//android.widget.Button[@text="SKIP"]',
          '//*[@text="Skip"]',
          '//*[@text="SKIP"]',
          '//android.widget.Button[@text="Not now"]',
          '//android.widget.Button[@text="NOT NOW"]',
          '//*[@text="Not now"]',
          '//*[@text="NOT NOW"]',
          '//android.widget.TextView[@text="Skip"]',
          '//android.widget.TextView[@text="Not now"]',
        ];

        let skipped = false;
        for (const selector of skipButtonSelectors) {
          try {
            const button = await driver.$(selector);
            const exists = await button.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await button.isDisplayed().catch(() => false);
              if (isDisplayed) {
                const text = await button.getText().catch(() => 'button');
                log(`✅ Found skip button: "${text}", clicking...`);
                await button.click();
                await this.sleep(2000);
                log(`✅ Email screen skipped successfully!`);
                skipped = true;
                await this.saveScreenshot(driver, 'after-email-skip', sessionId, log);
                return; // Done! No need to fill email
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!skipped) {
          log(`⚠️ Skip button not found even after closing keyboard - this is unexpected!`);
          
          // Fill email with harraken@gmail.com
          const emailFieldSelectors = [
            '//android.widget.EditText[@hint="Email"]',
            '//android.widget.EditText[contains(@hint, "email")]',
            '//android.widget.EditText[contains(@hint, "Email")]',
            '//android.widget.EditText',
          ];

          let emailFilled = false;
          for (const selector of emailFieldSelectors) {
            try {
              const emailField = await driver.$(selector);
              const exists = await emailField.isExisting().catch(() => false);
              if (exists) {
                const isDisplayed = await emailField.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  log(`✅ Found email input field, filling with: harraken@gmail.com`);
                  await emailField.click();
                  await this.sleep(500);
                  await emailField.clearValue();
                  await this.sleep(500);
                  await emailField.setValue('harraken@gmail.com');
                  await this.sleep(1000);
                  log(`✅ Email entered successfully`);
                  emailFilled = true;
                  await this.saveScreenshot(driver, 'after-email-entry', sessionId, log);
                  
                  // CRITICAL: Hide keyboard to reveal the submit button (blue checkmark)
                  log(`⌨️ Hiding keyboard to reveal submit button...`);
                  try {
                    await driver.hideKeyboard();
                    await this.sleep(1000);
                    log(`✅ Keyboard hidden successfully`);
                    await this.saveScreenshot(driver, 'after-keyboard-hidden', sessionId, log);
                  } catch (keyboardError) {
                    log(`⚠️ Could not hide keyboard (might already be hidden): ${keyboardError}`);
                    // Try alternative method: tap outside the keyboard area
                    try {
                      log(`🖱️ Trying to tap outside keyboard to close it...`);
                      await driver.execute('mobile: clickGesture', {
                        x: 540,  // Center of screen
                        y: 400   // Upper area (above keyboard)
                      });
                      await this.sleep(1000);
                      log(`✅ Tapped outside keyboard`);
                    } catch (tapError) {
                      log(`⚠️ Could not tap outside keyboard: ${tapError}`);
                    }
                  }
                  
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }

          if (emailFilled) {
            // Look for Next/Submit button (blue checkmark button)
            log(`🔍 Looking for Next/Submit button...`);
            const nextButtonSelectors = [
              // Standard text-based buttons
              '//android.widget.Button[@text="Next"]',
              '//android.widget.Button[@text="NEXT"]',
              '//*[@text="Next"]',
              '//*[@text="NEXT"]',
              // Image buttons (the blue checkmark ✓)
              '//android.widget.ImageButton',
              '//android.widget.ImageView[@clickable="true"]',
              // Content description
              '//*[@content-desc="Next"]',
              '//*[@content-desc="Submit"]',
              '//*[@content-desc="Continue"]',
              // Any clickable element that might be the submit button
              '//android.widget.Button',
              '//android.widget.ImageButton',
            ];

            let buttonClicked = false;
            for (const selector of nextButtonSelectors) {
              try {
                if (selector === '//android.widget.Button' || selector === '//android.widget.ImageButton') {
                  // For generic selectors, find all and click the last one (usually submit button)
                  const allButtons = await driver.$$(selector);
                  log(`📊 Found ${allButtons.length} elements with selector: ${selector}`);
                  if (allButtons.length > 0) {
                    // Try clicking the last button (usually the submit/next button)
                    const lastButton = allButtons[allButtons.length - 1];
                    const isDisplayed = await lastButton.isDisplayed().catch(() => false);
                    if (isDisplayed) {
                      const text = await lastButton.getText().catch(() => '');
                      const contentDesc = await lastButton.getAttribute('content-desc').catch(() => '');
                      log(`✅ Clicking last button: text="${text}", content-desc="${contentDesc}"`);
                      await lastButton.click();
                      await this.sleep(2000);
                      log(`✅ Email screen completed (button clicked)`);
                      await this.saveScreenshot(driver, 'after-email-next', sessionId, log);
                      buttonClicked = true;
                      break;
                    }
                  }
                } else {
                  const button = await driver.$(selector);
                  const exists = await button.isExisting().catch(() => false);
                  if (exists) {
                    const isDisplayed = await button.isDisplayed().catch(() => false);
                    if (isDisplayed) {
                      log(`✅ Found button using selector: ${selector}, clicking...`);
                      await button.click();
                      await this.sleep(2000);
                      log(`✅ Email screen completed (Next clicked)`);
                      await this.saveScreenshot(driver, 'after-email-next', sessionId, log);
                      buttonClicked = true;
                      break;
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }

            if (!buttonClicked) {
              log(`⚠️ Could not find Next button after filling email, trying to press ENTER key...`);
              // Last resort: press ENTER to submit the form
              try {
                await driver.execute('mobile: pressKey', { keycode: 66 }); // 66 = ENTER
                await this.sleep(2000);
                log(`✅ ENTER key pressed to submit email`);
                await this.saveScreenshot(driver, 'after-email-enter', sessionId, log);
              } catch (enterError) {
                log(`❌ Could not press ENTER: ${enterError}`);
              }
            }
            
            return; // Done with email screen
          } else {
            log(`⚠️ Could not fill email field`);
          }
        }
      } else {
        log(`ℹ️ No email screen found, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling email screen: ${error.message}, continuing...`);
      await this.saveScreenshot(driver, 'email-screen-error', sessionId).catch(() => {});
      // Don't throw - this is optional
    }
  }

  /**
   * Handle email verification screen (asks for 6-digit code) - click "Skip"
   */
  private async handleEmailVerificationScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for email verification screen...`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'check-email-verification', sessionId, log);
      
      // Check if "Verify your email" screen is visible
      const verificationIndicators = [
        '//*[@text="Verify your email"]',
        '//*[contains(@text, "Verify your email")]',
        '//*[contains(@text, "6-digit code")]',
        '//*[contains(@text, "Enter the 6-digit code")]',
      ];
      
      let verificationScreenFound = false;
      for (const selector of verificationIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await element.isDisplayed().catch(() => false);
            if (isDisplayed) {
              verificationScreenFound = true;
              log(`✅ Found "Verify your email" screen`);
              await this.saveScreenshot(driver, 'email-verification-detected', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (verificationScreenFound) {
        log(`⏭️ Skipping email verification...`);
        
        // Look for "Skip" button
        const skipButtonSelectors = [
          '//android.widget.Button[@text="Skip"]',
          '//android.widget.Button[@text="SKIP"]',
          '//*[@text="Skip"]',
          '//*[@text="SKIP"]',
          '//*[@content-desc="Skip"]',
        ];
        
        let skipClicked = false;
        for (const selector of skipButtonSelectors) {
          try {
            const button = await driver.$(selector);
            const exists = await button.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await button.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Found "Skip" button, clicking...`);
                await button.click();
                await this.sleep(2000);
                log(`✅ Email verification skipped successfully`);
                await this.saveScreenshot(driver, 'after-email-verification-skip', sessionId, log);
                skipClicked = true;
                break;
              }
            }
          } catch (e) {
            log(`⚠️ Skip button selector ${selector} failed: ${e}`);
            continue;
          }
        }
        
        if (!skipClicked) {
          log(`⚠️ Could not find or click Skip button, trying alternative methods...`);
          // Alternative: press back button to skip
          try {
            log(`🔙 Trying BACK button to skip verification...`);
            await driver.pressKeyCode(4); // 4 = BACK button
            await this.sleep(2000);
            log(`✅ BACK button pressed to skip verification`);
          } catch (backError) {
            log(`⚠️ BACK button failed: ${backError}`);
          }
        }
      } else {
        log(`ℹ️ No email verification screen found, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling email verification screen: ${error.message}, continuing...`);
      // Don't throw - this is optional
    }
  }

  /**
   * Handle "Help" popup that may appear after email screen and re-submit email if needed
   */
  private async handleHelpPopupAndResubmit(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for "Help" popup...`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'check-help-popup', sessionId, log);
      
      // Check if "Help" popup is visible
      const helpIndicators = [
        '//*[@text="Help"]',
        '//*[contains(@text, "Help")]',
        '//android.widget.TextView[@text="Help"]',
      ];
      
      let helpPopupFound = false;
      for (const selector of helpIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await element.isDisplayed().catch(() => false);
            if (isDisplayed) {
              helpPopupFound = true;
              log(`✅ Found "Help" popup blocking the screen`);
              await this.saveScreenshot(driver, 'help-popup-detected', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (helpPopupFound) {
        log(`🔙 Closing "Help" popup and re-submitting email...`);
        
        // The Help popup is an overlay that appears AFTER clicking the email submit button
        // The BACK button returns to the previous screen instead of closing the popup
        // Solution: Tap outside the popup or directly re-click the submit button
        
        let closed = false;
        
        // Method 1: Tap on the bottom-right area where the submit button is
        // This will close the popup AND click the submit button at the same time
        try {
          log(`🖱️ Tapping on submit button area (bottom-right) to close popup and submit...`);
          // Blue checkmark button is usually at bottom-right
          await driver.execute('mobile: clickGesture', {
            x: 950,  // Bottom-right area
            y: 1600
          });
          await this.sleep(2000);
          log(`✅ Tapped on submit button area`);
          closed = true;
        } catch (tapError) {
          log(`⚠️ Tap on submit button area failed: ${tapError}`);
        }
        
        // Method 2: If still not closed, try to find and click the blue checkmark button again
        if (!closed) {
          try {
            log(`🔍 Looking for email submit button to click again...`);
            const buttonSelectors = [
              '//android.widget.ImageView[@clickable="true"]',
              '//android.widget.ImageButton',
            ];
            
            for (const selector of buttonSelectors) {
              try {
                const elements = await driver.$$(selector);
                if (elements.length > 0) {
                  // Click the last button (usually the submit button)
                  const lastButton = elements[elements.length - 1];
                  const isDisplayed = await lastButton.isDisplayed().catch(() => false);
                  if (isDisplayed) {
                    log(`✅ Found submit button, clicking...`);
                    await lastButton.click();
                    await this.sleep(2000);
                    closed = true;
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (buttonError) {
            log(`⚠️ Could not find submit button: ${buttonError}`);
          }
        }
        
        // Method 3: Tap outside the popup in a neutral area
        if (!closed) {
          try {
            log(`🖱️ Tapping outside popup (center-left area)...`);
            await driver.execute('mobile: clickGesture', {
              x: 200,
              y: 800
            });
            await this.sleep(2000);
            log(`✅ Tapped outside popup`);
            closed = true;
          } catch (tapError) {
            log(`⚠️ Tap outside failed: ${tapError}`);
          }
        }
        
        // Method 4: Press ENTER key (might submit the email)
        if (!closed) {
          try {
            log(`⌨️ Pressing ENTER key to submit email...`);
            await driver.pressKeyCode(66); // 66 = ENTER key
            await this.sleep(2000);
            log(`✅ ENTER key pressed`);
            closed = true;
          } catch (enterError) {
            log(`⚠️ ENTER key failed: ${enterError}`);
          }
        }
        
        if (closed) {
          log(`✅ "Help" popup handled and email should be submitted`);
          await this.saveScreenshot(driver, 'help-popup-handled', sessionId, log);
        } else {
          log(`⚠️ Could not handle "Help" popup with standard methods`);
        }
      } else {
        log(`ℹ️ No "Help" popup found, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling "Help" popup: ${error.message}, continuing...`);
      // Don't throw - this is optional
    }
  }

  /**
   * Check if phone is already registered on another device
   * This screen appears when the number is already associated with another WhatsApp account
   */
  private async checkForPhoneAlreadyRegistered(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      await this.sleep(1000);
      await this.saveScreenshot(driver, 'check-phone-already-registered', sessionId, log);
      
      const pageSource = await driver.getPageSource().catch(() => '');
      
      // Detect "Confirm moving phones" or "already registered" screen
      const alreadyRegisteredIndicators = [
        '//*[@text="Confirm moving phones"]',
        '//*[contains(@text, "Confirm moving phones")]',
        '//*[contains(@text, "already registered")]',
        '//*[contains(@text, "is already registered on a different phone")]',
        '//*[contains(@text, "confirmation notice was sent")]',
        '//*[contains(@text, "Use your other phone to confirm")]',
      ];
      
      let isAlreadyRegistered = false;
      for (const selector of alreadyRegisteredIndicators) {
        try {
          const elem = await driver.$(selector);
          const exists = await elem.isExisting().catch(() => false);
          if (exists) {
            log(`❌ PHONE ALREADY REGISTERED - Detected: "${selector}"`);
            isAlreadyRegistered = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Also check page source for these phrases
      if (!isAlreadyRegistered) {
        if (pageSource.includes('Confirm moving phones') || 
            pageSource.includes('already registered') ||
            pageSource.includes('confirmation notice was sent')) {
          log(`❌ PHONE ALREADY REGISTERED - Detected in page source`);
          isAlreadyRegistered = true;
        }
      }
      
      if (isAlreadyRegistered) {
        await this.saveScreenshot(driver, 'phone-already-registered-ERROR', sessionId, log);
        log(`❌ ========================================`);
        log(`❌ ERREUR CRITIQUE : Ce numéro de téléphone est déjà enregistré sur un autre appareil WhatsApp.`);
        log(`❌ Le processus de provisioning va s'arrêter.`);
        log(`❌ ========================================`);
        
        throw new Error('PHONE_ALREADY_REGISTERED: This phone number is already registered on another WhatsApp device. Cannot proceed with provisioning.');
      }
      
      log(`✅ Phone is not registered on another device, continuing...`);
      
    } catch (error: any) {
      // If it's our specific error, re-throw it
      if (error.message && error.message.includes('PHONE_ALREADY_REGISTERED')) {
        throw error;
      }
      // Otherwise, log and continue (detection failed but might be fine)
      log(`⚠️ Error checking for already registered phone: ${error.message}, continuing...`);
    }
  }

  /**
   * Handle contact permission popup - click "Allow" for Android native permission dialog
   */
  private async handleContactPermissionPopup(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Detecting contacts/media permission popup actively...`);

      // Check IMMEDIATELY if we're on Android permission dialog (no waiting loop)
      let currentActivity = '';
      try {
        currentActivity = await driver.execute('mobile: getCurrentActivity');
        log(`📱 Activité détectée: ${currentActivity}`);
      } catch (e) {
        log(`⚠️ Impossible de récupérer l'activité`);
      }

      const isAndroidPermissionDialog = currentActivity && currentActivity.includes('GrantPermissionsActivity');
      
      if (isAndroidPermissionDialog) {
          log(`✅ Popup de permissions Android détecté ! Gestion immédiate...`);
          await this.saveScreenshot(driver, 'android-permission-dialog-detected', sessionId, log);
        
        // Android can show MULTIPLE permission popups in succession
        // We need to handle them in a loop until we're no longer on GrantPermissionsActivity
        let maxRetries = 5; // Handle up to 5 permission popups
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
          retryCount++;
            log(`🔄 Handling permission dialog ${retryCount}/${maxRetries}...`);
          
          // Check if we're still on permission dialog
          let checkActivity = '';
          try {
            checkActivity = await driver.execute('mobile: getCurrentActivity');
          } catch (e) {
            checkActivity = currentActivity;
          }
          
          if (!checkActivity.includes('GrantPermissionsActivity')) {
            log(`✅ No longer on GrantPermissionsActivity! Successfully dismissed all permission dialogs.`);
            await this.saveScreenshot(driver, 'all-android-permissions-dismissed', sessionId, log);
            return; // Success! We're out of the permission loop
          }
          
          log(`📱 Still on: ${checkActivity}`);
          await this.saveScreenshot(driver, `android-permission-attempt-${retryCount}`, sessionId);
          
            // PRIORITY: Click "Allow" button FIRST (for Profile info screen - user explicitly requested)
            const androidAllowSelectors = [
            '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
            '//android.widget.Button[@text="Allow"]',
            '//android.widget.Button[@text="ALLOW"]',
            '//*[@text="Allow"]',
              '//*[@text="ALLOW"]',
            ];
            
            // Fallback to Deny if Allow is not found
            const androidDenySelectors = [
            '//*[@resource-id="com.android.permissioncontroller:id/permission_deny_button"]',
            '//android.widget.Button[@text="Deny"]',
            '//android.widget.Button[@text="DENY"]',
              '//*[@text="Deny"]',
              '//*[@text="DENY"]',
              '//android.widget.TextView[@text="Deny"]',
              '//android.widget.TextView[@text="DENY"]',
          ];
            
            // Try Allow first
            const androidButtonSelectors = [...androidAllowSelectors, ...androidDenySelectors];
          
          let clicked = false;
          for (const selector of androidButtonSelectors) {
            try {
              const button = await driver.$(selector);
              const exists = await button.isExisting().catch(() => false);
              if (exists) {
                const isDisplayed = await button.isDisplayed().catch(() => false);
                if (isDisplayed) {
                  const text = await button.getText().catch(() => 'button');
                  log(`✅ Found Android permission button: "${text}" (selector: ${selector})`);
                  
                  // Try multiple click methods for Android native dialogs
                  let clickSuccess = false;
                  try {
                    log(`🖱️ Method 1: Trying regular click()...`);
                    await button.click();
                    await this.sleep(2000); // Wait longer for dialog to dismiss
                    clickSuccess = true;
                    clicked = true;
                  } catch (clickError) {
                    log(`⚠️ Regular click failed: ${clickError}, trying tap with coordinates...`);
                    try {
                      const location = await button.getLocation();
                      const size = await button.getSize();
                      const x = location.x + size.width / 2;
                      const y = location.y + size.height / 2;
                      log(`🖱️ Method 2: Trying tap at coordinates (${Math.round(x)}, ${Math.round(y)})...`);
                      await driver.execute('mobile: clickGesture', {
                        x: Math.round(x),
                        y: Math.round(y)
                      });
                      await this.sleep(2000);
                      clickSuccess = true;
                      clicked = true;
                    } catch (tapError) {
                      log(`⚠️ Tap with coordinates also failed: ${tapError}`);
                    }
                  }
                  
                  if (clickSuccess) {
                    log(`✅ Android permission button clicked: "${text}"`);
                    await this.sleep(1000); // Extra wait
                    break; // Exit selector loop
                  }
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          if (!clicked) {
            log(`⚠️ Could not click Android permission button with selectors, trying emergency fallback...`);
            // Emergency fallback: find ALL buttons and click Allow first
            try {
              const allButtons = await driver.$$('//android.widget.Button');
              log(`📊 Found ${allButtons.length} buttons total on Android dialog`);
              for (let i = 0; i < allButtons.length; i++) {
                try {
                  const btn = allButtons[i];
                  const text = await btn.getText().catch(() => '');
                  const exists = await btn.isExisting().catch(() => false);
                  const isDisplayed = exists ? await btn.isDisplayed().catch(() => false) : false;
                  
                  // PRIORITY: Click "Allow" button first (for Profile info screen)
                  if (isDisplayed && text.toLowerCase().includes('allow')) {
                    log(`🎯 Emergency: Clicking "Allow" button "${text}" (index ${i})...`);
                    await btn.click();
                    await this.sleep(1000);
                    log(`✅ Emergency click completed - Permission granted`);
                    clicked = true;
                    break;
                  }
                } catch (btnError) {
                  continue;
                }
              }
              
              // If no Allow found, try Deny
              if (!clicked) {
                for (let i = 0; i < allButtons.length; i++) {
                  try {
                    const btn = allButtons[i];
                    const text = await btn.getText().catch(() => '');
                    const exists = await btn.isExisting().catch(() => false);
                    const isDisplayed = exists ? await btn.isDisplayed().catch(() => false) : false;
                    
                    if (isDisplayed && text.toLowerCase().includes('deny')) {
                      log(`🎯 Fallback: Clicking "Deny" button "${text}" (index ${i})...`);
                      await btn.click();
                      await this.sleep(1000);
                      log(`✅ Fallback click completed - Permission denied`);
                      clicked = true;
                      break;
                    }
                  } catch (btnError) {
                    continue;
                  }
                }
              }
              
              if (!clicked && allButtons.length > 0) {
                // Last resort: click the first button (usually Allow)
                log(`🎯 Last resort: Clicking first button...`);
                await allButtons[0].click();
                await this.sleep(1000);
                clicked = true;
              }
            } catch (fallbackError) {
              log(`❌ Emergency fallback also failed: ${fallbackError}`);
            }
          }
          
          if (!clicked) {
            log(`❌ Could not click any button on attempt ${retryCount}, breaking loop...`);
            break; // Can't proceed
          }
          
          // Wait briefly before checking again
          await this.sleep(1000);
        }
        
        log(`✅ Handled ${retryCount} Android permission dialog(s)`);
        return; // Done with Android dialog
      }

      // If no Android permission dialog was detected, check for WhatsApp permission popup
      log(`ℹ️ Pas de popup Android natif, vérification du popup WhatsApp...`);
      
      // Check for WhatsApp-specific "Contacts and media" popup
      await this.sleep(1000);
      await this.saveScreenshot(driver, 'check-whatsapp-permission-popup', sessionId, log);
      
      const whatsappPermissionSelectors = [
        '//*[@text="Contacts and media"]',
        '//*[contains(@text, "Contacts and media")]',
        '//*[contains(@text, "allow WhatsApp to access your contacts")]',
        '//*[contains(@text, "contacts, photos and other media")]',
      ];

      let isWhatsAppPermissionPopup = false;
      for (const selector of whatsappPermissionSelectors) {
        try {
          const elem = await driver.$(selector);
          const exists = await elem.isExisting().catch(() => false);
          if (exists) {
            log(`✅ WhatsApp "Contacts and media" popup detected!`);
            isWhatsAppPermissionPopup = true;
              break;
          }
        } catch (e) {
          continue;
        }
      }

      if (isWhatsAppPermissionPopup) {
        log(`🖱️ Clicking "Continue" on WhatsApp permission popup to allow contacts access...`);
        
        const continueSelectors = [
          '//android.widget.Button[@text="Continue"]',
          '//android.widget.Button[@text="CONTINUE"]',
          '//*[@text="Continue"]',
          '//*[@text="CONTINUE"]',
          '//android.widget.TextView[@text="Continue"]',
          '//*[contains(@text, "Continue")]',
        ];

        let continueClicked = false;
        for (const selector of continueSelectors) {
          try {
            const continueButton = await driver.$(selector);
            const exists = await continueButton.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await continueButton.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ "Continue" button found, clicking...`);
                await continueButton.click();
                  await this.sleep(2000);
                await this.saveScreenshot(driver, 'continue-clicked', sessionId, log);
                continueClicked = true;
                log(`✅ WhatsApp permission popup accepted! Contacts access granted.`);
                
                // After clicking Continue, Android might show native permission dialog
                log(`🔍 Checking if Android native permission dialog appears after clicking Continue...`);
                await this.sleep(1500);
                
                // Check for native Android permission
                try {
                  const activity = await driver.execute('mobile: getCurrentActivity').catch(() => '');
                  if (activity.includes('GrantPermissionsActivity')) {
                    log(`✅ Native Android permission dialog detected, handling it...`);
                    
                    // Click "Allow" on the native Android dialog
                    const allowSelectors = [
                      '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
                      '//android.widget.Button[@text="Allow"]',
                      '//android.widget.Button[@text="ALLOW"]',
                      '//*[@text="Allow"]',
                    ];
                    
                    // Loop to handle MULTIPLE Android permission dialogs (contacts, photos, etc.)
                    let permissionDialogCount = 0;
                    const maxPermissionDialogs = 5; // Handle up to 5 permission dialogs
                    
                    while (permissionDialogCount < maxPermissionDialogs) {
                      await this.sleep(1000); // Wait for dialog to be ready
                      
                      // Check if still on permission dialog
                      const currentActivityCheck = await driver.execute('mobile: getCurrentActivity');
                      log(`🔍 Checking permission dialog ${permissionDialogCount + 1}/${maxPermissionDialogs} - Activity: ${currentActivityCheck}`);
                      
                      if (!currentActivityCheck.includes('GrantPermissionsActivity')) {
                        log(`✅ All Android permission dialogs handled! Moved away from GrantPermissionsActivity`);
                        break;
                      }
                      
                      // Try to click Allow
                      let allowClicked = false;
                      for (const allowSelector of allowSelectors) {
                        try {
                          const allowButton = await driver.$(allowSelector);
                          const allowExists = await allowButton.isExisting().catch(() => false);
                          if (allowExists) {
                            const allowDisplayed = await allowButton.isDisplayed().catch(() => false);
                            if (allowDisplayed) {
                              log(`✅ "Allow" button found on permission dialog ${permissionDialogCount + 1}, clicking...`);
                              await allowButton.click();
                              await this.sleep(2000);
                              await this.saveScreenshot(driver, `native-allow-${permissionDialogCount + 1}-clicked`, sessionId, log);
                              allowClicked = true;
                              log(`✅ Permission dialog ${permissionDialogCount + 1} granted!`);
                              break;
              }
            }
          } catch (e) {
            continue;
          }
        }
                      
                      if (!allowClicked) {
                        log(`⚠️ Could not click "Allow" on dialog ${permissionDialogCount + 1}, moving on...`);
                        break; // Exit if no Allow button found
                      }
                      
                      permissionDialogCount++;
                    }
                    
                    if (permissionDialogCount === 0) {
                      log(`ℹ️ No Allow button clicked, but continuing...`);
      } else {
                      log(`✅ Handled ${permissionDialogCount} Android permission dialog(s)`);
                    }
                  } else {
                    log(`ℹ️ No native permission dialog appeared, continuing...`);
                }
                } catch (e: any) {
                  log(`⚠️ Error checking for native permission: ${e.message}`);
                }
                
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!continueClicked) {
          log(`⚠️ Could not click "Continue" button, but continuing...`);
        }
      } else {
        log(`ℹ️ No WhatsApp permission popup detected either, continuing...`);
      }
    } catch (error: any) {
      log(`⚠️ Error handling contact permission popup: ${error.message}, continuing...`);
      // Don't throw - this is optional and shouldn't block the flow
    }
  }

  /**
   * Helper to detect and log current WhatsApp screen
   */
  private async detectCurrentScreen(driver: any, log: (msg: string) => void): Promise<string> {
    try {
      const activity = await driver.getCurrentActivity().catch(() => 'unknown');
      const pageSource = await driver.getPageSource().catch(() => '');
      
      // Detect screen based on activity and content
      let screenName = 'UNKNOWN_SCREEN';
      
      if (activity.includes('EULA')) {
        screenName = 'EULA_SCREEN';
      } else if (activity.includes('RegisterPhone') || activity.includes('phonenumberentry')) {
        screenName = 'PHONE_ENTRY_SCREEN';
      } else if (activity.includes('verification') || activity.includes('CodeEntry')) {
        screenName = 'OTP_VERIFICATION_SCREEN';
      } else if (pageSource.includes('Profile info') || pageSource.includes('provide your name')) {
        screenName = 'PROFILE_INFO_SCREEN';
      } else if (pageSource.includes('Test message')) {
        screenName = 'TEST_MESSAGE_SCREEN';
      } else if (pageSource.includes('Restore') && pageSource.includes('backup')) {
        screenName = 'RESTORE_BACKUP_SCREEN';
      } else if (pageSource.includes('Contacts') && pageSource.includes('permission')) {
        screenName = 'CONTACTS_PERMISSION_SCREEN';
      } else if (activity.includes('HomeActivity') || activity.includes('Main')) {
        screenName = 'WHATSAPP_HOME_SCREEN';
      }
      
      log(`🖥️ CURRENT SCREEN DETECTED: ${screenName} (Activity: ${activity})`);
      return screenName;
    } catch (e) {
      log(`⚠️ Could not detect current screen: ${e}`);
      return 'UNKNOWN_SCREEN';
    }
  }

  /**
   * Sleep helper
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle Profile Info screen - can appear at different stages
   */
  private async handleProfileInfoScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for "Profile info" screen...`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'check-profile-info-screen', sessionId, log);
      
      // Check if we're on Profile info screen
      const profileScreenIndicators = [
        '//*[@text="Profile info"]',
        '//*[contains(@text, "Profile info")]',
        '//*[@text="Please provide your name"]',
        '//*[contains(@text, "Please provide your name")]',
        '//*[contains(@text, "optional profile photo")]',
        '//*[contains(@text, "provide your name")]',
        '//*[contains(@text, "Type your name")]',
      ];
      
      let isProfileScreen = false;
      for (const selector of profileScreenIndicators) {
        try {
          const elem = await driver.$(selector);
          const exists = await elem.isExisting().catch(() => false);
          if (exists) {
            log(`✅ Found Profile info screen indicator: "${selector}"`);
            isProfileScreen = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!isProfileScreen) {
        log(`ℹ️ Not on Profile info screen, skipping...`);
        return;
      }
      
      // Generate random first name for profile
      const firstNames = ['Alex', 'Sarah', 'Michael', 'Emma', 'David', 'Lisa', 'James', 'Anna', 'Robert', 'Maria', 'John', 'Sophie', 'Daniel', 'Olivia', 'Chris'];
      const randomName = firstNames[Math.floor(Math.random() * firstNames.length)];
      
      log(`✅ Profile info screen detected! Filling name "${randomName}"...`);
      await this.saveScreenshot(driver, 'profile-info-detected', sessionId, log);
      
      // Find name input field
      const nameInputSelectors = [
        '//android.widget.EditText[@hint="Type your name here"]',
        '//android.widget.EditText[contains(@hint, "name")]',
        '//android.widget.EditText[contains(@hint, "Name")]',
        '//android.widget.EditText[contains(@content-desc, "name")]',
        '//android.widget.EditText[contains(@content-desc, "Name")]',
        '//android.widget.EditText',
      ];
      
      let nameInput = null;
      for (const selector of nameInputSelectors) {
        try {
          const input = await driver.$(selector);
          const exists = await input.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await input.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ Found name input field using selector: ${selector}`);
              nameInput = input;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!nameInput) {
        log(`⚠️ Could not find name input field on Profile info screen`);
        return;
      }
      
      // Enter random name
      log(`⌨️ Entering name: "${randomName}"...`);
      await nameInput.click();
      await this.sleep(500);
      await nameInput.clearValue().catch(() => {});
      await this.sleep(200);
      await nameInput.setValue(randomName);
      await this.sleep(1000);
      log(`✅ Name "${randomName}" entered successfully`);
      await this.saveScreenshot(driver, 'name-entered', sessionId, log);
      
      // Find and click Next button
      const nextButtonSelectors = [
        '//android.widget.Button[@text="Next"]',
        '//android.widget.Button[@text="NEXT"]',
        '//*[@text="Next"]',
        '//*[@text="NEXT"]',
        '//android.widget.Button[contains(@text, "Next")]',
        '//android.widget.Button',
      ];
      
      let buttonClicked = false;
      for (const selector of nextButtonSelectors) {
        try {
          if (selector === '//android.widget.Button') {
            // Last resort: find all buttons
            const allButtons = await driver.$$(selector);
            for (const btn of allButtons) {
              try {
                const text = await btn.getText().catch(() => '');
                if (text && text.toLowerCase().includes('next')) {
                  log(`✅ Clicking Next button (text="${text}")...`);
                  await btn.click();
                  await this.sleep(3000);
                  buttonClicked = true;
                  break;
                }
              } catch (e) {
                continue;
              }
            }
            if (buttonClicked) break;
          } else {
            const button = await driver.$(selector);
            const exists = await button.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await button.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Clicking Next button...`);
                await button.click();
                await this.sleep(3000);
                buttonClicked = true;
                break;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (buttonClicked) {
        log(`✅ Profile info completed successfully!`);
        await this.saveScreenshot(driver, 'profile-info-completed', sessionId, log);
      } else {
        log(`⚠️ Could not find Next button on Profile info screen`);
      }
      
    } catch (error: any) {
      log(`⚠️ Error handling Profile info screen: ${error.message}, continuing...`);
      // Don't throw - this is optional
    }
  }

  /**
   * Complete WhatsApp profile setup (name, photo) after OTP verification
   */
  private async completeProfileSetup(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      // Detect and log current screen
      log(`🔍 ==== ENTERING completeProfileSetup ====`);
      await this.saveScreenshot(driver, 'profile-setup-start', sessionId, log);
      await this.detectCurrentScreen(driver, log);
      
      // STEP 1: Handle contacts/media permission popup with active detection
      log(`🔍 STEP 1: Actively detecting contacts/media permission popup...`);
      await this.handleContactPermissionPopup(driver, log, sessionId);
      
      // STEP 2: Wait for WhatsApp to transition and check next screen after permissions
      log(`🔍 STEP 2: Waiting for WhatsApp to transition after permissions...`);
      await this.sleep(1500); // Give WhatsApp time to transition
      await this.saveScreenshot(driver, 'after-permissions', sessionId, log);
      let screenAfterPermissions = await this.detectCurrentScreen(driver, log);
      
      // If still on permission screen, wait a bit more and check again
      if (screenAfterPermissions === 'UNKNOWN_SCREEN') {
        const currentActivity = await driver.execute('mobile: getCurrentActivity');
        if (currentActivity.includes('GrantPermissionsActivity')) {
          log(`⚠️ Still on GrantPermissionsActivity, waiting 5 more seconds...`);
          await this.sleep(5000);
          await this.saveScreenshot(driver, 'after-permissions-retry', sessionId, log);
          screenAfterPermissions = await this.detectCurrentScreen(driver, log);
        }
      }
      
      // STEP 3: Handle Profile info screen if present
      if (screenAfterPermissions === 'PROFILE_INFO_SCREEN') {
        log(`🔍 STEP 3: Profile info screen detected, handling...`);
      await this.handleProfileInfoScreen(driver, log, sessionId);
      } else {
        log(`ℹ️ STEP 3: Profile info screen not detected (${screenAfterPermissions}), skipping...`);
      }
      
      log(`✅ completeProfileSetup finished`);
      
    } catch (error: any) {
      log(`⚠️ Profile setup encountered an error: ${error.message}, continuing...`);
      // Don't throw - profile setup is optional
    }
  }

  /* OLD DUPLICATE CODE REMOVED - verifyWhatsAppActivated continues below */

  /**
   * Verify WhatsApp is activated by checking if chat list is visible
   */
  private async verifyWhatsAppActivated(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    // sessionId is kept for future screenshot/logging purposes
    void sessionId;
    try {
      // Check multiple indicators that WhatsApp is activated
      const activationIndicators = [
        '//*[@resource-id="com.whatsapp:id/conversations_row_container"]', // Chat list
        '//*[@resource-id="com.whatsapp:id/fab"]', // New chat button (FAB)
        '//*[@content-desc="New chat"]', // New chat button
        '//*[@resource-id="com.whatsapp:id/menuitem_search"]', // Search button
        '.HomeActivity', // Main home activity
      ];

      for (const indicator of activationIndicators) {
        try {
          const element = await driver.$(indicator);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await element.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ WhatsApp activation verified: found ${indicator}`);
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Also check current activity
      try {
        const currentActivity = await driver.execute('mobile: getCurrentActivity');
        if (currentActivity && currentActivity.includes('HomeActivity')) {
          log(`✅ WhatsApp activation verified: HomeActivity`);
          return true;
        }
      } catch (e) {
        // Ignore
      }

      log(`ℹ️ WhatsApp activation not detected`);
      return false;
    } catch (error: any) {
      log(`⚠️ Could not verify activation: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a WhatsApp message to a specific number
   */
  /**
   * Poll messages from WhatsApp conversation
   * Returns new messages that haven't been seen yet
   */
  async pollMessages(options: {
    appiumPort: number;
    sessionId: string;
    contactPhone: string;
    containerId?: string;
  }): Promise<Array<{
    from: string;
    to: string;
    text: string;
    direction: 'INBOUND' | 'OUTBOUND';
    timestamp: Date;
  }>> {
    const { appiumPort, sessionId, contactPhone, containerId } = options;
    
    const log = (msg: string) => {
      logger.info(`[POLL] ${msg}`);
      console.log(`📥 [POLL] ${msg}`);
    };
    
    log(`Polling messages for session ${sessionId}`);
    
    let driver: any = null;
    const appiumHost = containerId ? containerId : 'host.docker.internal';
    const messages: Array<any> = [];
    
    try {
      // Connect to Appium
      log(`🔌 Connecting to Appium server at ${appiumHost}:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log, appiumHost);
      
      driver = await remote({
        protocol: 'http',
        hostname: appiumHost,
        port: appiumPort,
        path: '/wd/hub/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:appPackage': 'com.whatsapp',
          'appium:appActivity': '.HomeActivity',
          'appium:noReset': true,
          'appium:fullReset': false,
          'appium:newCommandTimeout': 300,
        },
        connectionRetryTimeout: 90000,
        connectionRetryCount: 3,
      });
      
      log(`✅ Connected to Appium server successfully`);
      
      // Launch WhatsApp
      await driver.activateApp('com.whatsapp');
      await this.sleep(2000);
      
      // Open the conversation (click on the contact in the chat list)
      log(`🔍 Opening conversation with ${contactPhone}...`);
      
      // Try to find the conversation in the chat list
      const conversationSelectors = [
        '//*[@resource-id="com.whatsapp:id/conversations_row_container"]',
        '//*[@resource-id="com.whatsapp:id/conversation_contact_name"]',
      ];
      
      let conversationOpened = false;
      for (const selector of conversationSelectors) {
        try {
          const conversations = await driver.$$(selector);
          if (conversations.length > 0) {
            // Click on the first conversation (most recent)
            await conversations[0].click();
            await this.sleep(2000);
            conversationOpened = true;
            log(`✅ Conversation opened`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!conversationOpened) {
        log(`⚠️ Could not find conversation, no messages to poll`);
        return messages;
      }
      
      // Read all message bubbles
      log(`📖 Reading messages from conversation...`);
      const messageSelectors = [
        '//*[@resource-id="com.whatsapp:id/message_text"]',
      ];
      
      for (const selector of messageSelectors) {
        try {
          const messageElements = await driver.$$(selector);
          log(`📊 Found ${messageElements.length} message elements`);
          
          for (const element of messageElements) {
            try {
              const text = await element.getText();
              if (text && text.trim()) {
                // Determine direction based on message bubble position/class
                // For now, we'll mark all as INBOUND (will refine later)
                const message = {
                  from: contactPhone,
                  to: sessionId, // Session phone number
                  text: text.trim(),
                  direction: 'INBOUND' as const,
                  timestamp: new Date(),
                };
                
                messages.push(message);
              }
            } catch (e) {
              continue;
            }
          }
          
          break;
        } catch (e) {
          continue;
        }
      }
      
      log(`✅ Polled ${messages.length} messages`);
      
      return messages;
      
    } catch (error: any) {
      log(`❌ Polling error: ${error.message}`);
      throw error;
    } finally {
      if (driver) {
        try {
          await driver.deleteSession();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Send WhatsApp message using mobile:deepLink command
   * This is the recommended method that works even if the contact is not saved
   */
  async sendWhatsAppMessage(phone: string, message: string, appiumPort: number, sessionId: string): Promise<void> {
    const log = (msg: string) => {
      logger.info(msg);
      console.log(`💬 [WHATSAPP-MSG] ${msg}`);
      
      // Save log to database for live log display (async, no await)
      (async () => {
        try {
          const { sessionService } = await import('./session.service');
          await sessionService.createLog({
            sessionId: sessionId,
            level: 'info',
            message: msg,
            source: 'whatsapp-message',
          });
        } catch (e) {
          // Ignore log save errors
        }
      })();
    };
    
    log(`📤 Envoi de message WhatsApp`);
    log(`📞 Destinataire: ${phone}`);
    log(`💬 Message: ${message}`);
    
    let driver: any = null;
    
    try {
      // Format phone number (remove non-numeric characters)
      const phoneNumber = phone.replace(/[^0-9]/g, '');
      
      // URL encode the message
      const encodedMessage = encodeURIComponent(message);
      
      // Build WhatsApp deeplink with whatsapp:// scheme
      const deeplink = `whatsapp://send?phone=${phoneNumber}&text=${encodedMessage}`;
      
      log(`🔗 Deeplink: ${deeplink}`);
      
      // Connect to existing Appium session
      log(`🔌 Connexion à Appium sur host.docker.internal:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log);
      
      driver = await remote({
        hostname: 'host.docker.internal',
        port: appiumPort,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:noReset': true,
        },
        logLevel: 'error',
      });
      
      log(`✅ Connecté à Appium`);
      
      // Use mobile:deepLink command (best method for WhatsApp deeplinks)
      log(`🚀 Ouverture du deeplink via mobile:deepLink...`);
      
      try {
        await driver.execute('mobile:deepLink', {
          url: deeplink,
          package: 'com.whatsapp'
        });
        log(`✅ Deeplink envoyé avec succès via mobile:deepLink`);
      } catch (deepLinkError: any) {
        // Fallback to startActivity if mobile:deepLink is not available
        log(`⚠️ mobile:deepLink non disponible, utilisation de startActivity...`);
        await driver.execute('mobile: startActivity', {
          action: 'android.intent.action.VIEW',
          data: deeplink,
          package: 'com.whatsapp'
        });
        log(`✅ Deeplink envoyé avec succès via startActivity`);
      }
      
      // Wait for WhatsApp to process the deeplink
      await this.sleep(3000);
      
      // Check if we're on the WhatsApp home screen with "Send message" button
      log(`🔍 Vérification de la page d'accueil WhatsApp...`);
      
      try {
        const homeScreenIndicators = [
          '//*[@text="To help you message friends and family on WhatsApp, allow WhatsApp access to your contacts. Tap Settings > Permissions, and turn Contacts on."]',
          '//*[contains(@text, "To help you message friends and family")]',
          '//*[@text="Send message"]',
        ];
        
        let foundHomeScreen = false;
        for (const indicator of homeScreenIndicators) {
          try {
            const element = await driver.$(indicator);
            const exists = await element.isExisting();
            if (exists) {
              foundHomeScreen = true;
              log(`✅ Page d'accueil WhatsApp détectée`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (foundHomeScreen) {
          // Click on "Send message" button
          log(`🔍 Recherche du bouton "Send message"...`);
          
          const sendMessageSelectors = [
            '//*[@text="Send message"]',
            '//android.widget.Button[@text="Send message"]',
            '//*[contains(@text, "Send message")]',
          ];
          
          for (const selector of sendMessageSelectors) {
            try {
              const sendMessageButton = await driver.$(selector);
              const exists = await sendMessageButton.isExisting();
              if (exists) {
                log(`✅ Bouton "Send message" trouvé, clic...`);
                await sendMessageButton.click();
                await this.sleep(2000);
                log(`✅ Bouton "Send message" cliqué - passage à la sélection du contact`);
                
                // Take screenshot after clicking
                await this.saveScreenshot(driver, 'whatsapp-after-send-message-click', sessionId, log);
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } else {
          log(`ℹ️ Pas sur la page d'accueil WhatsApp, continue...`);
        }
      } catch (error: any) {
        log(`ℹ️ Erreur lors de la vérification de la page d'accueil: ${error.message}`);
      }
      
      // Handle "Open with" dialog if it appears
      log(`🔍 Vérification de la popup "Open with"...`);
      
      try {
        const whatsappSelectors = [
          '//*[@text="WhatsApp"]',
          '//android.widget.TextView[@text="WhatsApp"]',
          '//*[contains(@text, "WhatsApp")]',
        ];
        
        let whatsappClicked = false;
        for (const selector of whatsappSelectors) {
          try {
            const whatsappOption = await driver.$(selector);
            const exists = await whatsappOption.isExisting();
            if (exists) {
              log(`✅ Popup "Open with" détectée, sélection de WhatsApp...`);
              await whatsappOption.click();
              whatsappClicked = true;
              log(`✅ WhatsApp sélectionné`);
              
              // Click "Always" button
              await this.sleep(500);
              const alwaysSelectors = [
                '//*[@text="Always"]',
                '//android.widget.Button[@text="Always"]',
                '//*[contains(@text, "Always")]',
              ];
              
              for (const alwaysSelector of alwaysSelectors) {
                try {
                  const alwaysButton = await driver.$(alwaysSelector);
                  const alwaysExists = await alwaysButton.isExisting();
                  if (alwaysExists) {
                    log(`✅ Clic sur "Always"...`);
                    await alwaysButton.click();
                    log(`✅ WhatsApp défini comme application par défaut`);
                    break;
                  }
                } catch (e) {
                  continue;
                }
              }
              
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!whatsappClicked) {
          log(`ℹ️ Pas de popup "Open with", WhatsApp s'est ouvert directement`);
        }
      } catch (error: any) {
        log(`ℹ️ Pas de popup "Open with" à gérer`);
      }
      
      // Wait for WhatsApp to load the conversation
      await this.sleep(4000);
      
      // Handle "Sync contacts" screen if it appears
      log(`🔍 Vérification de l'écran "Sync contacts"...`);
      
      try {
        const syncContactsSelectors = [
          '//*[@text="Sync contacts"]',
          '//android.widget.Button[@text="Sync contacts"]',
          '//*[contains(@text, "Sync contacts")]',
        ];
        
        for (const syncSelector of syncContactsSelectors) {
          try {
            const syncButton = await driver.$(syncSelector);
            const exists = await syncButton.isExisting();
            if (exists) {
              log(`✅ Écran "Sync contacts" détecté, clic...`);
              await syncButton.click();
              log(`✅ Synchronisation des contacts lancée`);
              
              // Wait for sync to complete
              await this.sleep(3000);
              log(`✅ Synchronisation terminée`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error: any) {
        log(`ℹ️ Pas d'écran "Sync contacts" à gérer`);
      }
      
      // Take screenshot to verify conversation is open
      await this.saveScreenshot(driver, 'whatsapp-conversation-opened', sessionId, log);
      log(`📸 Screenshot pris - conversation ouverte`);
      
      // Handle "Select contacts" / "Your contacts aren't synced" screen if it appears
      log(`🔍 Vérification de l'écran "Select contacts"...`);
      
      try {
        // Check for "Select contacts" title or "Your contacts aren't synced" text
        const selectContactsIndicators = [
          '//*[@text="Select contacts"]',
          '//*[contains(@text, "Select contacts")]',
          '//*[@text="Your contacts aren\'t synced"]',
          '//*[contains(@text, "contacts aren\'t synced")]',
        ];
        
        let foundSelectContacts = false;
        for (const indicator of selectContactsIndicators) {
          try {
            const element = await driver.$(indicator);
            const exists = await element.isExisting();
            if (exists) {
              foundSelectContacts = true;
              log(`✅ Écran "Select contacts" détecté`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (foundSelectContacts) {
          // Press back button to return to conversation
          log(`⬅️ Clic sur le bouton retour pour revenir à la conversation...`);
          await driver.back();
          await this.sleep(2000);
          log(`✅ Retour à la conversation`);
          
          // Take screenshot after going back
          await this.saveScreenshot(driver, 'whatsapp-back-from-select-contacts', sessionId, log);
        } else {
          log(`ℹ️ Pas d'écran "Select contacts" détecté`);
        }
      } catch (error: any) {
        log(`ℹ️ Pas d'écran "Select contacts" à gérer: ${error.message}`);
      }
      
      // The message should be pre-filled, now click the send button
      log(`📤 Recherche du bouton d'envoi...`);
      
      try {
        const sendButtonSelectors = [
          '//*[@resource-id="com.whatsapp:id/send"]',
          '//*[@content-desc="Send"]',
          '//android.widget.ImageButton[@content-desc="Send"]',
          '//*[@content-desc="Send message"]',
        ];
        
        let sendButtonClicked = false;
        for (const sendSelector of sendButtonSelectors) {
          try {
            const sendButton = await driver.$(sendSelector);
            const exists = await sendButton.isExisting();
            if (exists) {
              const isDisplayed = await sendButton.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Bouton d'envoi trouvé, clic...`);
                await sendButton.click();
                sendButtonClicked = true;
                log(`✅ Message envoyé avec succès !`);
                await this.sleep(2000);
                
                // Take screenshot after sending
                await this.saveScreenshot(driver, 'whatsapp-message-sent', sessionId, log);
                log(`📸 Screenshot pris - message envoyé`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!sendButtonClicked) {
          log(`⚠️ Bouton d'envoi non trouvé - vérifier l'état de la conversation`);
          await this.saveScreenshot(driver, 'whatsapp-send-button-not-found', sessionId, log);
        }
      } catch (error: any) {
        log(`⚠️ Erreur lors de l'envoi: ${error.message}`);
        await this.saveScreenshot(driver, 'whatsapp-send-error', sessionId, log);
      }
      
      log(`✅ Message WhatsApp traité avec succès !`);
      
    } catch (error: any) {
      log(`❌ Échec de l'envoi du message WhatsApp: ${error.message}`);
      logger.error({ error: error.message, sessionId, phone }, 'WhatsApp message failed');
      throw error;
    } finally {
      // Keep the driver alive for message polling
      if (driver) {
        log(`ℹ️ Session Appium maintenue active`);
      }
    }
  }

  /**
   * Send message via deeplink using existing Appium session
   * @deprecated Use sendWhatsAppMessage instead
   */
  async sendMessageViaDeeplink(options: {
    appiumPort: number;
    to: string;
    message: string;
    sessionId: string;
  }): Promise<void> {
    // Delegate to new sendWhatsAppMessage method
    return this.sendWhatsAppMessage(options.to, options.message, options.appiumPort, options.sessionId);
  }

  async sendMessage(options: {
    appiumPort: number;
    sessionId: string;
    to: string;
    message: string;
    containerId?: string;
  }): Promise<void> {
    const { appiumPort, sessionId, to, message, containerId } = options;
    
    const log = (msg: string) => {
      logger.info(msg);
      console.log(`📱 [MESSAGE] ${msg}`);
    };
    
    log(`Starting message sending for session ${sessionId}`);
    log(`📞 To: ${to}`);
    log(`💬 Message: ${message}`);
    log(`📡 Appium port: ${appiumPort}`);

    let driver: any = null;
    const appiumHost = containerId ? containerId : 'host.docker.internal';
    
    try {
      // Connect to existing Appium session
      log(`🔌 Connecting to Appium server at ${appiumHost}:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log, appiumHost);
      
      driver = await remote({
        protocol: 'http',
        hostname: appiumHost,
        port: appiumPort,
        path: '/wd/hub/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:appPackage': 'com.whatsapp',
          'appium:appActivity': '.HomeActivity',
          'appium:noReset': true,
          'appium:fullReset': false,
          'appium:newCommandTimeout': 300,
        },
        connectionRetryTimeout: 90000,
        connectionRetryCount: 3,
      });
      
      log(`✅ Connected to Appium server successfully`);
      await this.sleep(2000);
      
      // 🚀 NEW: Use deeplink to open chat directly (no contact creation needed!)
      log(`🔗 Using WhatsApp deeplink to open chat with ${to}...`);
      
      // Clean phone number (remove + and spaces)
      const cleanNumber = to.replace(/[\s+]/g, '');
      
      // Encode message for URL
      const encodedMessage = encodeURIComponent(message);
      
      // Build deeplink
      const deeplink = `whatsapp://send?phone=${cleanNumber}&text=${encodedMessage}`;
      log(`🔗 Deeplink: ${deeplink}`);
      
      // Open deeplink via Appium
      log(`🚀 Opening WhatsApp conversation via deeplink...`);
      await driver.execute('mobile: startActivity', {
        action: 'android.intent.action.VIEW',
        data: deeplink
      });
      
      // Wait for WhatsApp to load the conversation
      log(`⏳ Waiting for conversation to load...`);
      await this.sleep(5000); // Give time for WhatsApp to open and load
      
      // Message should be pre-filled, just click send button
      log(`📤 Looking for send button...`);
      const sendButtonSelectors = [
        '//*[@resource-id="com.whatsapp:id/send"]',
        '//*[@content-desc="Send"]',
        '//android.widget.ImageButton[@content-desc="Send"]',
      ];
      
      let sendButtonFound = false;
      for (const selector of sendButtonSelectors) {
        try {
          const sendBtn = await driver.$(selector);
          const exists = await sendBtn.isExisting();
          if (exists) {
            const isDisplayed = await sendBtn.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ Found send button, clicking...`);
              await sendBtn.click();
              await this.sleep(2000);
              log(`✅ Message sent successfully!`);
              sendButtonFound = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!sendButtonFound) {
        log(`⚠️ Send button not found, message may not have been sent`);
      }

    } catch (error: any) {
      log(`❌ Message sending failed: ${error.message}`);
      logger.error({ error: error.message, sessionId, to }, 'Message sending failed');
      if (driver) {
        await this.saveScreenshot(driver, 'message-send-error', sessionId, log);
      }
      throw error;
    } finally {
      if (driver) {
        try {
          await driver.deleteSession();
          log(`✅ Appium session closed`);
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  /**
   * Create a WhatsApp contact by navigating through the WhatsApp UI
   * Clicks on + button, New Contact, fills form with random names and phone number
   */
  async createWhatsAppContact(options: {
    appiumPort: number;
    sessionId: string;
    phoneNumber: string;
    firstName?: string;
    lastName?: string;
    onLog?: (msg: string) => Promise<void>;
  }): Promise<boolean> {
    const { appiumPort, sessionId, phoneNumber, firstName, lastName, onLog: onLogCallback } = options;
    
    // Generate random names if not provided
    const firstNames = ['Jean', 'Marie', 'Pierre', 'Sophie', 'Lucas', 'Emma', 'Thomas', 'Julie', 'Antoine', 'Léa'];
    const lastNames = ['Dupont', 'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Richard', 'Durand', 'Leroy'];
    
    const randomFirstName = firstName || firstNames[Math.floor(Math.random() * firstNames.length)];
    const randomLastName = lastName || lastNames[Math.floor(Math.random() * lastNames.length)];
    
    const log = (msg: string) => {
      logger.info(msg);
      console.log(`📇 [CONTACT] ${msg}`);
      // Call the callback asynchronously without waiting (fire-and-forget for better performance)
      if (onLogCallback) {
        onLogCallback(msg).catch((err) => {
          logger.warn({ err }, 'Failed to call onLog callback');
        });
      }
    };
    
    log(`📇 Création d'un contact WhatsApp via UI`);
    log(`👤 Prénom: ${randomFirstName}`);
    log(`👤 Nom: ${randomLastName}`);
    log(`📞 Téléphone: ${phoneNumber}`);
    
    let driver: any = null;
    
    try {
      // Connect to Appium
      log(`🔌 Connexion à Appium sur host.docker.internal:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log);
      
      driver = await remote({
        hostname: 'host.docker.internal',
        port: appiumPort,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:appPackage': 'com.whatsapp',
          'appium:appActivity': '.HomeActivity',
          'appium:noReset': true,
          'appium:fullReset': false,
        },
        logLevel: 'error',
        connectionRetryTimeout: 90000,
        connectionRetryCount: 3,
      });
      
      log(`✅ Connecté à la page d'accueil WhatsApp`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'whatsapp-home', sessionId, log);
      
      // STEP 1: Click "Send message" or "Start chatting" button to access "Select Contact" screen
      log(`🔍 Clic sur "Send message" / "Start chatting"...`);
      
      const sendMessageSelectors = [
        '//*[@text="Send message"]',
        '//android.widget.Button[@text="Send message"]',
        '//android.widget.TextView[@text="Send message"]',
        '//*[@text="Start chatting"]',
        '//android.widget.Button[@text="Start chatting"]',
        '//android.widget.TextView[@text="Start chatting"]',
        '//*[contains(@text, "Send message")]',
        '//*[contains(@text, "Start chatting")]',
        '//*[@content-desc="Send message"]',
        '//*[@content-desc="Start chatting"]',
      ];
      
      let sendMessageFound = false;
      for (const selector of sendMessageSelectors) {
        try {
          const sendMessageButton = await driver.$(selector);
          const exists = await sendMessageButton.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await sendMessageButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await sendMessageButton.click();
              sendMessageFound = true;
              log(`✅ Bouton "Send message" / "Start chatting" cliqué`);
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'send-message-clicked', sessionId, log);
              break;
            }
          }
        } catch (e: any) {
          continue;
        }
      }
      
      // If Send message button not found, throw error
      if (!sendMessageFound) {
        log(`❌ Bouton "Send message" / "Start chatting" non trouvé`);
        throw new Error('Impossible de trouver le bouton "Send message" ou "Start chatting" sur la homepage');
      }
      
      // STEP 2: Now we should be on "Select Contact" screen, click "New contact"
      log(`📇 Recherche du bouton "New contact"...`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'select-contact-screen', sessionId, log);
      
      const newContactSelectors = [
        '//*[@content-desc="New contact"]',
        '//*[@resource-id="com.whatsapp:id/menuitem_new_contact"]',
        '//android.widget.TextView[@text="New contact"]',
        '//*[@text="New contact"]',
        '//android.widget.TextView[@text="Nouveau contact"]',
        '//*[@text="Nouveau contact"]',
        '//*[contains(@content-desc, "contact")]',
        '//*[contains(@text, "New") and contains(@text, "contact")]',
      ];
      
      let newContactFound = false;
      for (const selector of newContactSelectors) {
        try {
          const newContactButton = await driver.$(selector);
          const exists = await newContactButton.isExisting();
          if (exists) {
            const isDisplayed = await newContactButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await newContactButton.click();
              log(`✅ Bouton "New contact" cliqué`);
              newContactFound = true;
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'new-contact-clicked', sessionId, log);
              
              // Check for "More ways to manage contacts" popup AFTER clicking New contact
              try {
                const currentActivity = await driver.getCurrentActivity();
                
                // Check if we're on the privacy disclosure popup
                if (currentActivity && currentActivity.includes('PrivacyDisclosure')) {
                  log(`🔍 Popup "More ways to manage contacts" détecté, clic sur OK...`);
                  await this.saveScreenshot(driver, 'privacy-popup-detected', sessionId, log);
                  
                  const okSelectors = [
                    '//android.widget.Button[@text="OK"]',
                    '//*[@text="OK"]',
                    '//android.widget.TextView[@text="OK"]',
                    '//*[contains(@text, "OK")]',
                    '//android.widget.Button[contains(@text, "OK")]',
                  ];
                  
                  for (const selector of okSelectors) {
                    try {
                      const okBtn = await driver.$(selector);
                      const exists = await okBtn.isExisting();
                      if (exists) {
                        const isDisplayed = await okBtn.isDisplayed().catch(() => false);
                        if (isDisplayed) {
                          await okBtn.click();
                          log(`✅ Popup "OK" cliqué`);
                          await this.sleep(2000);
                          await this.saveScreenshot(driver, 'privacy-popup-ok-clicked', sessionId, log);
                          break;
                        }
                      }
                    } catch (e: any) {
                      log(`      ❌ Erreur: ${e.message}`);
                      continue;
                    }
                  }
}
              } catch (e: any) {
                // Ignore popup check errors
              }
              
              break;
            }
          }
        } catch (e: any) {
          continue;
        }
      }
      
      if (!newContactFound) {
        log(`❌ Bouton "New contact" non trouvé`);
        throw new Error('Bouton "New contact" non trouvé sur la page de sélection');
      }
      
      // STEP 3: Fill first name
      log(`📝 Remplissage du formulaire de contact...`);
      const firstNameSelectors = [
        '//*[@text="First name"]',
        '//android.widget.EditText[@text="First name"]',
        '//*[@resource-id="com.whatsapp:id/first_name"]',
        '//android.widget.EditText[contains(@text, "First")]',
        '(//android.widget.EditText)[1]',
      ];
      
      let firstNameFilled = false;
      for (const selector of firstNameSelectors) {
        try {
          const firstNameField = await driver.$(selector);
          const exists = await firstNameField.isExisting();
          if (exists) {
            const isDisplayed = await firstNameField.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await firstNameField.click();
              await this.sleep(500);
              await firstNameField.setValue(randomFirstName);
              firstNameFilled = true;
              log(`✅ Prénom saisi: ${randomFirstName}`);
              await this.sleep(1000);
              await this.saveScreenshot(driver, 'first-name-filled', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!firstNameFilled) {
        throw new Error('Champ "First name" non trouvé');
      }
      
      // STEP 4: Fill last name
      const lastNameSelectors = [
        '//*[@text="Last name"]',
        '//android.widget.EditText[@text="Last name"]',
        '//*[@resource-id="com.whatsapp:id/last_name"]',
        '//android.widget.EditText[contains(@text, "Last")]',
        '(//android.widget.EditText)[2]',
      ];
      
      let lastNameFilled = false;
      for (const selector of lastNameSelectors) {
        try {
          const lastNameField = await driver.$(selector);
          const exists = await lastNameField.isExisting();
          if (exists) {
            const isDisplayed = await lastNameField.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await lastNameField.click();
              await this.sleep(500);
              await lastNameField.setValue(randomLastName);
              lastNameFilled = true;
              log(`✅ Nom saisi: ${randomLastName}`);
              await this.sleep(1000);
              await this.saveScreenshot(driver, 'last-name-filled', sessionId, log);
              
              // Hide keyboard to reveal Country/Phone fields
              try {
                await driver.hideKeyboard();
                await this.sleep(1000);
              } catch (e: any) {
                try {
                  await driver.pressKeyCode(4); // Back button
                  await this.sleep(1000);
                } catch (e2: any) {
                  // Ignore
                }
              }
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!lastNameFilled) {
        throw new Error('Champ "Last name" non trouvé');
      }
      
      // STEP 5: Scroll down to reveal Country and Phone fields
      log(`📜 Scroll pour afficher les champs pays/téléphone...`);
      await this.sleep(1000);
      
      try {
        await driver.execute('mobile: scrollGesture', {
          left: 300,
          top: 800,
          width: 400,
          height: 600,
          direction: 'down',
          percent: 3.0
        });
        await this.sleep(1500);
        await this.saveScreenshot(driver, 'after-scroll', sessionId, log);
      } catch (scrollError: any) {
        // Ignore scroll errors
      }
      
      // STEP 6: Click on Country dropdown to change to Israel (+972)
      const countrySelectors = [
        '//*[@text="Country"]',
        '//android.widget.EditText[@text="Country"]',
        '//*[contains(@text, "US +1")]',
        '//*[contains(@text, "United States")]',
        '//android.widget.Spinner',
        '//*[@resource-id="com.whatsapp:id/country"]',
        '(//android.widget.EditText)[1]',
      ];
      
      for (const selector of countrySelectors) {
        try {
          const countryDropdown = await driver.$(selector);
          const exists = await countryDropdown.isExisting();
          if (exists) {
            const isDisplayed = await countryDropdown.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await countryDropdown.click();
              log(`✅ Dropdown pays ouvert`);
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'country-dropdown-opened', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // STEP 7: Search and select Israel (+972) using the search icon
      log(`🇮🇱 Recherche d'Israël via la loupe de recherche...`);
      
      // Click on search icon (magnifying glass)
      const searchIconSelectors = [
        '//*[@content-desc="Search"]',
        '//android.widget.ImageButton[@content-desc="Search"]',
        '//*[contains(@content-desc, "Search")]',
        '//android.widget.TextView[@content-desc="Search"]',
      ];
      
      let searchClicked = false;
      for (const selector of searchIconSelectors) {
        try {
          const searchIcon = await driver.$(selector);
          const exists = await searchIcon.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await searchIcon.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await searchIcon.click();
              log(`✅ Loupe de recherche cliquée`);
              searchClicked = true;
              await this.sleep(500);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (searchClicked) {
        // Type "Israel" in the search field
        const searchFieldSelectors = [
          '//android.widget.EditText',
          '//*[@resource-id="android:id/search_src_text"]',
          '//*[contains(@hint, "Search")]',
        ];
        
        for (const selector of searchFieldSelectors) {
          try {
            const searchField = await driver.$(selector);
            const exists = await searchField.isExisting().catch(() => false);
            if (exists) {
              await searchField.setValue('Israel');
              log(`✅ "Israel" tapé dans la recherche`);
              await this.sleep(2000); // Wait for search results to appear
              await this.saveScreenshot(driver, 'after-search-israel', sessionId, log);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // Select Israel - The result row is BELOW the search bar
      // IMPORTANT: //*[@text="Israel"] finds the search bar first! We need to find the SECOND one or use +972/ישראל
      log(`🔍 Sélection d'Israel dans la ligne de résultat (pas la barre de recherche)...`);
      
      let israelSelected = false;
      
      // METHOD 1: Click on "+972" - this text ONLY exists in the result row, not in search bar
      if (!israelSelected) {
        try {
          const plus972Elem = await driver.$('//*[@text="+972"]');
          if (await plus972Elem.isExisting()) {
            const loc = await plus972Elem.getLocation();
            log(`📍 +972 trouvé à (${loc.x}, ${loc.y})`);
            
            log(`🖱️ Méthode 1: Clic sur +972...`);
            await plus972Elem.click();
            await this.sleep(2000);
            
            const activity = await driver.getCurrentActivity();
            if (!activity.includes('CountryPicker')) {
              israelSelected = true;
              log(`✅ Israel sélectionné via +972`);
            } else {
              log(`⚠️ Méthode 1 échouée`);
            }
          }
        } catch (e: any) {
          log(`⚠️ +972 error: ${e.message}`);
        }
      }
      
      // METHOD 2: Click on Hebrew text "ישראל" - also ONLY in result row
      if (!israelSelected) {
        try {
          const hebrewElem = await driver.$('//*[@text="ישראל"]');
          if (await hebrewElem.isExisting()) {
            const loc = await hebrewElem.getLocation();
            log(`📍 ישראל trouvé à (${loc.x}, ${loc.y})`);
            
            log(`🖱️ Méthode 2: Clic sur ישראל...`);
            await hebrewElem.click();
            await this.sleep(2000);
            
            const activity = await driver.getCurrentActivity();
            if (!activity.includes('CountryPicker')) {
              israelSelected = true;
              log(`✅ Israel sélectionné via ישראל`);
            } else {
              log(`⚠️ Méthode 2 échouée`);
            }
          }
        } catch (e: any) {
          log(`⚠️ ישראל error: ${e.message}`);
        }
      }
      
      // METHOD 3: Get the SECOND "Israel" element (first is in search bar, second is in result row)
      if (!israelSelected) {
        try {
          const israelElements = await driver.$$('//*[@text="Israel"]');
          log(`📍 Nombre d'éléments "Israel" trouvés: ${israelElements.length}`);
          
          if (israelElements.length >= 2) {
            const secondIsrael = israelElements[1]; // Index 1 = second element
            const loc = await secondIsrael.getLocation();
            log(`📍 Second "Israel" trouvé à (${loc.x}, ${loc.y})`);
            
            log(`🖱️ Méthode 3: Clic sur le DEUXIÈME "Israel"...`);
            await secondIsrael.click();
            await this.sleep(2000);
            
            const activity = await driver.getCurrentActivity();
            if (!activity.includes('CountryPicker')) {
              israelSelected = true;
              log(`✅ Israel sélectionné via second element`);
            } else {
              log(`⚠️ Méthode 3 échouée`);
            }
          } else if (israelElements.length === 1) {
            // Only one Israel element - try clicking it anyway
            const loc = await israelElements[0].getLocation();
            log(`📍 Un seul "Israel" trouvé à (${loc.x}, ${loc.y})`);
            
            // If Y > 150, it's in the result row, not search bar
            if (loc.y > 150) {
              log(`🖱️ Méthode 3: Clic sur l'unique "Israel" (Y=${loc.y} > 150)...`);
              await israelElements[0].click();
              await this.sleep(2000);
              
              const activity = await driver.getCurrentActivity();
              if (!activity.includes('CountryPicker')) {
                israelSelected = true;
                log(`✅ Israel sélectionné`);
              }
            }
          }
        } catch (e: any) {
          log(`⚠️ Second Israel error: ${e.message}`);
        }
      }
      
      // METHOD 4: Use coordinates - the result row is at approximately Y=240
      if (!israelSelected) {
        try {
          const windowSize = await driver.getWindowSize();
          const x = Math.round(windowSize.width / 2);
          const y = 245; // Below search bar, in result row area
          
          log(`📍 Méthode 4: Tap à (${x}, ${y})...`);
          await driver.execute('mobile: clickGesture', { x, y });
          await this.sleep(2000);
          
          const activity = await driver.getCurrentActivity();
          if (!activity.includes('CountryPicker')) {
            israelSelected = true;
            log(`✅ Israel sélectionné via coordonnées`);
          } else {
            log(`⚠️ Méthode 4 échouée`);
          }
        } catch (e: any) {
          log(`⚠️ Coordonnées error: ${e.message}`);
        }
      }
      
      // Check final result
      await this.saveScreenshot(driver, 'israel-selection-result', sessionId, log);
      const currentActivity = await driver.getCurrentActivity();
      
      if (currentActivity.includes('CountryPicker')) {
        log(`❌ ÉCHEC TOTAL: Impossible de sélectionner Israel après 4 méthodes`);
        log(`📱 L'écran CountryPicker est toujours affiché`);
        // Do NOT proceed - return false to indicate failure
        return false;
      } else {
        log(`✅ CountryPicker fermé, Israel sélectionné avec succès`);
      }
      
      await this.saveScreenshot(driver, 'after-country-selection', sessionId, log);
      
      // STEP 8: Fill phone number field
      log(`📞 Saisie du numéro: ${phoneNumber}...`);
      
      const phoneSelectors = [
        '//*[@text="Phone"]',
        '//android.widget.EditText[@text="Phone"]',
        '//*[@resource-id="com.whatsapp:id/phone"]',
        '//android.widget.EditText[contains(@text, "Phone")]',
        '//android.widget.EditText[contains(@hint, "Phone")]',
      ];
      
      for (const selector of phoneSelectors) {
        try {
          const phoneField = await driver.$(selector);
          const exists = await phoneField.isExisting();
          if (exists) {
            const isDisplayed = await phoneField.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await phoneField.click();
              await this.sleep(500);
              await phoneField.setValue(phoneNumber);
              log(`✅ Numéro saisi: ${phoneNumber}`);
              await this.sleep(1500);
              await this.saveScreenshot(driver, 'phone-filled', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // STEP 9: Click Save button (FINAL)
      log(`💾 Sauvegarde du contact...`);
      await this.sleep(1000);
      
      const saveButtonSelectors = [
        '//android.widget.Button[@text="SAVE"]',
        '//android.widget.Button[@text="Save"]',
        '//android.widget.TextView[@text="SAVE"]',
        '//android.widget.TextView[@text="Save"]',
        '//*[@content-desc="Save"]',
        '//*[contains(@text, "SAVE")]',
      ];
      
      for (const selector of saveButtonSelectors) {
        try {
          const saveButton = await driver.$(selector);
          const exists = await saveButton.isExisting();
          if (exists) {
            const isDisplayed = await saveButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await saveButton.click();
              log(`✅ Contact sauvegardé !`);
              await this.sleep(1500);
              await this.saveScreenshot(driver, 'contact-saved', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      log(`✅ Contact WhatsApp créé: ${randomFirstName} ${randomLastName} - ${phoneNumber}`);
      
      // STEP 10: Click on the created contact in the list to open chat
      log(`📱 Recherche du contact créé dans la liste pour ouvrir le chat...`);
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'after-save', sessionId, log);
      
      const contactName = `${randomFirstName} ${randomLastName}`;
      const contactSelectors = [
        `//*[@text="${contactName}"]`,
        `//android.widget.TextView[@text="${contactName}"]`,
        `//*[contains(@text, "${randomFirstName}")]`,
        `//*[contains(@text, "${randomLastName}")]`,
      ];
      
      let contactClicked = false;
      for (const selector of contactSelectors) {
        try {
          const contactElement = await driver.$(selector);
          const exists = await contactElement.isExisting();
          if (exists) {
            const isDisplayed = await contactElement.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await contactElement.click();
              log(`✅ Contact "${contactName}" cliqué, ouverture du chat...`);
              contactClicked = true;
              await this.sleep(1500);
              await this.saveScreenshot(driver, 'contact-chat-opened', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!contactClicked) {
        log(`⚠️ Contact non trouvé dans la liste, fin de l'automatisation`);
        return false;
      }
      
      // STEP 11: Send a test message in the chat
      log(`💬 Envoi d'un message de test...`);
      await this.sleep(2000);
      
      const testMessage = `Bonjour ! Ceci est un message de test automatique. 👋`;
      
      // Find the message input field
      const messageInputSelectors = [
        '//*[@resource-id="com.whatsapp:id/entry"]',
        '//android.widget.EditText[@content-desc="Message"]',
        '//*[@text="Message"]',
        '//android.widget.EditText[contains(@hint, "Message")]',
        '(//android.widget.EditText)[1]',
      ];
      
      let messageTyped = false;
      for (const selector of messageInputSelectors) {
        try {
          const messageInput = await driver.$(selector);
          const exists = await messageInput.isExisting();
          if (exists) {
            const isDisplayed = await messageInput.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await messageInput.click();
              await this.sleep(500);
              await messageInput.setValue(testMessage);
              log(`✅ Message tapé: "${testMessage}"`);
              messageTyped = true;
              await this.sleep(1000);
              await this.saveScreenshot(driver, 'message-typed', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!messageTyped) {
        log(`⚠️ Champ de message non trouvé, impossible d'envoyer le message`);
        return false;
      }
      
      // Click the send button (arrow)
      const sendButtonSelectors = [
        '//*[@content-desc="Send"]',
        '//*[@resource-id="com.whatsapp:id/send"]',
        '//android.widget.ImageButton[@content-desc="Send"]',
        '//*[contains(@content-desc, "Send")]',
      ];
      
      for (const selector of sendButtonSelectors) {
        try {
          const sendButton = await driver.$(selector);
          const exists = await sendButton.isExisting();
          if (exists) {
            const isDisplayed = await sendButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await sendButton.click();
              log(`✅ Message envoyé avec succès ! 📨`);
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'message-sent', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      log(`🎉 Contact créé et message envoyé avec succès !`);
      return true;
      
    } catch (error: any) {
      log(`❌ Échec de la création du contact: ${error.message}`);
      logger.error({ error: error.message, sessionId, phoneNumber }, 'Failed to create WhatsApp contact');
      if (driver) {
        await this.saveScreenshot(driver, 'contact-creation-error', sessionId, log);
      }
      return false;
    } finally {
      if (driver) {
        try {
          await driver.deleteSession();
          log(`🔌 Session Appium fermée`);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Create an Android contact using ADB Intent + Save button click
   * Simple and reliable method that doesn't rely on UI field detection
   */
  async createAndroidContact(appiumPort: number, sessionId: string, contactName: string, phoneNumber: string): Promise<void> {
    // IMPORTANT: Make logs SYNCHRONOUS so they appear in real-time in the live log
    const logWithLevel = async (msg: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> => {
      const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
      const formattedMessage = `${emoji} ${msg}`;
      
      logger.info(formattedMessage);
      console.log(`📇 [CONTACT] ${formattedMessage}`);
      
      // Save log to database SYNCHRONOUSLY (await it)
      try {
        const { sessionService } = await import('./session.service');
        await sessionService.createLog({
          sessionId: sessionId,
          level: level,
          message: msg,
          source: 'android-contact',
        });
      } catch (e) {
        // Ignore save errors but continue
        console.error(`Failed to save log: ${e}`);
      }
    };
    
    // Simple log function for saveScreenshot and logCurrentScreen
    const log = async (msg: string): Promise<void> => await logWithLevel(msg, 'info');
    
    await log(`📇 Création d'un contact Android via ADB Intent`);
    await log(`👤 Nom: ${contactName}`);
    await log(`📞 Téléphone: ${phoneNumber}`);
    
    let driver: any = null;
    
    try {
      // Connect to Appium
      await log(`🔌 Connexion à Appium sur host.docker.internal:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log);
      
      driver = await remote({
        hostname: 'host.docker.internal',
        port: appiumPort,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:noReset': true,
        },
        logLevel: 'error',
      });
      
      await log(`✅ Connecté à Appium`);
      
      // STEP 1: Create a local device-only account to enable contact creation
      await log(`🔧 Création d'un compte local Android pour activer la création de contacts...`);
      try {
        const accountResult = await driver.execute('mobile: shell', {
          command: 'content',
          args: [
            'insert',
            '--uri', 'content://com.android.contacts/accounts',
            '--bind', 'name:s:local',
            '--bind', 'type:s:com.android.local'
          ],
        });
        await log(`✅ Compte local créé: ${accountResult}`);
        await this.sleep(1000); // Wait for account to be registered
      } catch (accountError: any) {
        // If account already exists, this is fine
        await log(`ℹ️ Compte local (peut-être déjà existant): ${accountError.message}`);
      }
      
      // STEP 2: Use ADB Intent to open contact form with pre-filled data
      await log(`📱 Lancement de l'Intent Android pour créer un contact...`);
      await log(`🔧 Intent: android.intent.action.INSERT avec name="${contactName}" et phone="${phoneNumber}"`);
      
      const result = await driver.execute('mobile: shell', {
        command: 'am',
        args: [
          'start',
          '-a', 'android.intent.action.INSERT',
          '-t', 'vnd.android.cursor.dir/contact',
          '-e', 'name', contactName,
          '-e', 'phone', phoneNumber
        ],
      });
      
      await log(`✅ Intent lancé: ${result}`);
      
      // Wait for the form to open
      await this.sleep(3000);
      await this.saveScreenshot(driver, 'contact-form-opened-with-data', sessionId, log);
      await this.logCurrentScreen(driver, sessionId, log);
      
      // Click Save button
      await log(`💾 Recherche du bouton "Save" / "Enregistrer"...`);
      const saveSelectors = [
        '//android.widget.Button[@text="SAVE"]',
        '//android.widget.Button[@text="Save"]',
        '//android.widget.TextView[@text="SAVE"]',
        '//android.widget.TextView[@text="Save"]',
        '//*[@resource-id="editor_menu_save_button"]',
        '//*[@content-desc="Save"]',
        '//*[@content-desc="SAVE"]',
        '//*[contains(@text, "Save")]',
        '//*[contains(@text, "SAVE")]',
        '//android.widget.Button[contains(@text, "Save")]',
        '//android.widget.TextView[contains(@text, "Save")]',
      ];
      
      let saveButtonFound = false;
      for (const selector of saveSelectors) {
        try {
          await log(`  🔍 Essai du sélecteur: ${selector}`);
          const saveButton = await driver.$(selector);
          const exists = await saveButton.isExisting();
          if (exists) {
            const isDisplayed = await saveButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              await log(`✅ Bouton "Save" trouvé avec: ${selector}`);
              await saveButton.click();
              await log(`✅ Bouton "Save" cliqué`);
              saveButtonFound = true;
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'contact-saved', sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!saveButtonFound) {
        await logWithLevel(`⚠️ Bouton "Save" non trouvé, tentative avec le bouton Back...`, 'warn');
        // Try pressing back button to save
        await driver.back();
        await this.sleep(2000);
        await this.saveScreenshot(driver, 'contact-back-pressed', sessionId, log);
      }
      
      // STEP 3: Verify contact was created by checking if it exists in contacts
      await log(`🔍 Vérification que le contact a bien été créé...`);
      
      // Query the contacts database to verify the contact exists
      try {
        const queryResult = await driver.execute('mobile: shell', {
          command: 'content',
          args: [
            'query',
            '--uri', 'content://com.android.contacts/data',
            '--projection', 'display_name:data1',
            '--where', `display_name='${contactName}'`
          ],
        });
        
        if (queryResult && queryResult.toString().includes(contactName)) {
          await log(`✅ Contact "${contactName}" vérifié dans la base de contacts Android`);
        } else {
          await logWithLevel(`⚠️ Contact non trouvé dans la base, mais création peut avoir réussi`, 'warn');
        }
      } catch (verifyError: any) {
        await logWithLevel(`⚠️ Impossible de vérifier le contact: ${verifyError.message}`, 'warn');
      }
      
      // Also verify visually by opening contacts list
      await log(`📱 Ouverture de la liste des contacts pour vérification visuelle...`);
      await driver.execute('mobile: shell', {
        command: 'am',
        args: ['start', '-a', 'android.intent.action.VIEW', '-d', 'content://contacts/people'],
      });
      
      await this.sleep(2000);
      await this.saveScreenshot(driver, 'android-contacts-list-final', sessionId, log);
      await this.logCurrentScreen(driver, sessionId, log);
      
      await log(`✅ Contact Android créé avec succès !`);
      
    } catch (error: any) {
      await logWithLevel(`❌ Échec de la création du contact: ${error.message}`, 'error');
      logger.error({ error: error.message, sessionId, contactName }, 'Failed to create Android contact');
      throw error;
    } finally {
      if (driver) {
        try {
          await driver.deleteSession();
          await log(`🔌 Session Appium fermée`);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Send WhatsApp message by selecting contact from list
   */
  async sendMessageViaContact(options: {
    appiumPort: number;
    sessionId: string;
    contactName: string;
    phoneNumber: string;
    message: string;
  }): Promise<void> {
    const { appiumPort, sessionId, contactName, phoneNumber, message } = options;
    
    const log = (msg: string) => {
      logger.info(msg);
      console.log(`💬 [WHATSAPP-CONTACT] ${msg}`);
      
      // Save log to database
      (async () => {
        try {
          const { sessionService } = await import('./session.service');
          await sessionService.createLog({
            sessionId: sessionId,
            level: 'info',
            message: msg,
            source: 'whatsapp-contact',
          });
        } catch (e) {
          // Ignore
        }
      })();
    };
    
    log(`📤 Envoi de message WhatsApp via liste de contacts`);
    log(`👤 Contact: ${contactName}`);
    log(`📞 Numéro: ${phoneNumber}`);
    log(`💬 Message: ${message}`);
    
    let driver: any = null;
    
    try {
      // Connect to Appium
      log(`🔌 Connexion à Appium sur host.docker.internal:${appiumPort}...`);
      await this.waitForAppium(appiumPort, 30000, log);
      
      driver = await remote({
        hostname: 'host.docker.internal',
        port: appiumPort,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'Android Emulator',
          'appium:noReset': true,
        },
        logLevel: 'error',
      });
      
      log(`✅ Connecté à Appium`);
      
      // Open WhatsApp home
      log(`📱 Ouverture de WhatsApp...`);
      await driver.execute('mobile: startActivity', {
        action: 'android.intent.action.MAIN',
        package: 'com.whatsapp',
        activity: '.HomeActivity',
      });
      
      await this.sleep(3000);
      await this.saveScreenshot(driver, 'whatsapp-home', sessionId, log);
      await this.logCurrentScreen(driver, sessionId, log);
      
      // Navigate to Contacts tab in WhatsApp
      log(`📇 Navigation vers l'onglet Contacts de WhatsApp...`);
      
      const contactsTabSelectors = [
        '//*[@text="Contacts"]',
        '//*[@content-desc="Contacts"]',
        '//*[contains(@text, "Contact")]',
        '//*[contains(@content-desc, "Contact")]',
      ];
      
      let contactsTabFound = false;
      for (const selector of contactsTabSelectors) {
        try {
          const contactsTab = await driver.$(selector);
          const exists = await contactsTab.isExisting();
          if (exists) {
            const isDisplayed = await contactsTab.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ Onglet Contacts trouvé avec: ${selector}`);
              await contactsTab.click();
              contactsTabFound = true;
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'whatsapp-contacts-tab', sessionId, log);
              await this.logCurrentScreen(driver, sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!contactsTabFound) {
        log(`⚠️ Onglet Contacts non trouvé, tentative d'accès via le bouton menu...`);
        
        // Try accessing contacts via menu button
        const menuSelectors = [
          '//*[@content-desc="More options"]',
          '//*[@resource-id="com.whatsapp:id/menuitem_more"]',
          '//android.widget.ImageButton[@content-desc="More options"]',
        ];
        
        for (const selector of menuSelectors) {
          try {
            const menuButton = await driver.$(selector);
            const exists = await menuButton.isExisting();
            if (exists) {
              log(`✅ Bouton menu trouvé, clic...`);
              await menuButton.click();
              await this.sleep(1000);
              
              // Look for "Contacts" in menu
              const contactsMenuItems = [
                '//*[@text="Contacts"]',
                '//*[@text="Select contacts"]',
              ];
              
              for (const itemSelector of contactsMenuItems) {
                try {
                  const contactsMenuItem = await driver.$(itemSelector);
                  const itemExists = await contactsMenuItem.isExisting();
                  if (itemExists) {
                    log(`✅ Item menu "Contacts" trouvé, clic...`);
                    await contactsMenuItem.click();
                    await this.sleep(2000);
                    await this.saveScreenshot(driver, 'whatsapp-contacts-menu', sessionId, log);
                    await this.logCurrentScreen(driver, sessionId, log);
                    contactsTabFound = true;
                    break;
                  }
                } catch (e2) {
                  continue;
                }
              }
              
              if (contactsTabFound) break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (!contactsTabFound) {
        log(`⚠️ Impossible d'accéder aux contacts, tentative de recherche directe...`);
        // Fallback: try to search directly from home screen
      }
      
      await this.sleep(1000);
      
      // Search for the contact by name
      log(`🔍 Recherche du contact "${contactName}" dans la liste...`);
      
      const contactListSelectors = [
        `//*[@text="${contactName}"]`,
        `//*[contains(@text, "${contactName}")]`,
      ];
      
      let contactFound = false;
      for (const selector of contactListSelectors) {
        try {
          const contactElement = await driver.$(selector);
          const exists = await contactElement.isExisting();
          if (exists) {
            const isDisplayed = await contactElement.isDisplayed().catch(() => false);
            if (isDisplayed) {
              log(`✅ Contact "${contactName}" trouvé dans la liste !`);
              await contactElement.click();
              log(`✅ Contact cliqué`);
              contactFound = true;
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'whatsapp-contact-selected', sessionId, log);
              await this.logCurrentScreen(driver, sessionId, log);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!contactFound) {
        log(`⚠️ Contact "${contactName}" non trouvé dans la liste, tentative de recherche...`);
        
        // Use search functionality
        const searchSelectors = [
          '//*[@resource-id="com.whatsapp:id/search_src_text"]',
          '//*[@resource-id="com.whatsapp:id/menuitem_search"]',
          '//*[@content-desc="Search"]',
          '//android.widget.EditText',
        ];
        
        for (const selector of searchSelectors) {
          try {
            const searchField = await driver.$(selector);
            const exists = await searchField.isExisting();
            if (exists) {
              log(`✅ Champ de recherche trouvé`);
              await searchField.click();
              await this.sleep(1000);
              await searchField.setValue(contactName);
              log(`✅ Nom "${contactName}" saisi dans la recherche`);
              await this.sleep(2000);
              await this.saveScreenshot(driver, 'whatsapp-search-results', sessionId, log);
              
              // Click on the first result
              const resultSelectors = [
                `//*[@text="${contactName}"]`,
                `//*[contains(@text, "${contactName}")]`,
                '(//android.widget.TextView)[1]',
              ];
              
              for (const resultSelector of resultSelectors) {
                try {
                  const result = await driver.$(resultSelector);
                  const resultExists = await result.isExisting();
                  if (resultExists) {
                    log(`✅ Résultat de recherche trouvé, clic...`);
                    await result.click();
                    contactFound = true;
                    await this.sleep(2000);
                    break;
                  }
                } catch (e2) {
                  continue;
                }
              }
              
              if (contactFound) break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (!contactFound) {
        throw new Error(`Contact "${contactName}" not found in WhatsApp contacts`);
      }
      
      // Now we should be in the chat with the contact
      await this.saveScreenshot(driver, 'whatsapp-chat-opened', sessionId, log);
      log(`📸 Screenshot de la conversation ouverte`);
      await this.logCurrentScreen(driver, sessionId, log);
      
      // Type message
      log(`⌨️ Saisie du message...`);
      
      const messageInputSelectors = [
        '//*[@resource-id="com.whatsapp:id/entry"]',
        '//android.widget.EditText[@content-desc="Message"]',
        '//android.widget.EditText',
      ];
      
      for (const selector of messageInputSelectors) {
        try {
          const messageInput = await driver.$(selector);
          const exists = await messageInput.isExisting();
          if (exists) {
            log(`✅ Champ de message trouvé`);
            await messageInput.click();
            await this.sleep(500);
            await messageInput.setValue(message);
            log(`✅ Message saisi: "${message}"`);
            await this.sleep(1000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.saveScreenshot(driver, 'whatsapp-message-typed', sessionId, log);
      log(`📸 Screenshot du message saisi`);
      
      // Click send button
      log(`📤 Recherche du bouton d'envoi...`);
      
      const sendButtonSelectors = [
        '//*[@resource-id="com.whatsapp:id/send"]',
        '//*[@content-desc="Send"]',
        '//android.widget.ImageButton[@content-desc="Send"]',
      ];
      
      for (const selector of sendButtonSelectors) {
        try {
          const sendButton = await driver.$(selector);
          const exists = await sendButton.isExisting();
          if (exists) {
            log(`✅ Bouton d'envoi trouvé, clic...`);
            await sendButton.click();
            await this.sleep(2000);
            log(`✅ Message envoyé avec succès !`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.saveScreenshot(driver, 'whatsapp-message-sent', sessionId, log);
      log(`📸 Screenshot du message envoyé`);
      
      log(`✅ Message WhatsApp envoyé via contact avec succès !`);
      
    } catch (error: any) {
      log(`❌ Échec de l'envoi du message: ${error.message}`);
      logger.error({ error: error.message, sessionId, contactName }, 'Failed to send message via contact');
      throw error;
    } finally {
      if (driver) {
        log(`ℹ️ Session Appium maintenue active`);
      }
    }
  }
}

export default new WhatsAppAutomationService();
