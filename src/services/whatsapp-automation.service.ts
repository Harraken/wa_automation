import { createChildLogger } from '../utils/logger';
import { remote, RemoteOptions } from 'webdriverio';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { clickViaVnc, clickViaAdb, clickNextButtonViaVnc, clickAgreeButtonViaVnc, clickNextButtonViaAdb, clickOkButtonViaAdb, smartClickNextViaVnc, smartClickOkViaVnc, smartClickAgreeViaVnc, clickViaNativeVnc, debugX11WindowPosition, clickViaXdotoolWithWindowDetection } from '../utils/vncClick';
import { getLearnedClick } from '../services/click-capture.service';

const logger = createChildLogger('whatsapp-automation');

export interface AutomationOptions {
  appiumPort: number;
  phoneNumber?: string; // Now optional! Will be provided by buyNumberCallback
  sessionId: string;
  containerId?: string; // Container ID for ADB installation
  vncPort?: number; // VNC port for clicking via VNC (bypasses anti-bot detection)
  countryName?: string; // Country name (e.g., "Canada", "United States") to help WhatsApp select correct country
  buyNumberCallback?: () => Promise<{ number: string; request_id: string }>; // Callback to buy number when ready
  onLog?: (message: string) => void; // Callback for detailed logs
  onStateChange?: (state: string, progress: number, message: string) => Promise<void>; // Callback for state changes
}

export class WhatsAppAutomationService {
  /**
   * Save screenshot for debugging
   */
  private async saveScreenshot(driver: any, step: string, sessionId: string): Promise<void> {
    try {
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
      console.log(`📸 [SCREENSHOT] Saved: ${filepath}`);
    } catch (error: any) {
      logger.warn({ error: error.message, step }, 'Failed to save screenshot');
      console.log(`⚠️ [SCREENSHOT] Failed to save screenshot for step "${step}": ${error.message}`);
      console.log(`⚠️ [SCREENSHOT] Error stack: ${error.stack}`);
    }
  }

  /**
   * Get current activity via ADB (fallback when Appium session is terminated)
   */
  private async getCurrentActivityViaAdb(containerId: string, log: (msg: string) => void): Promise<string> {
    try {
      const Docker = (await import('dockerode')).default;
      const docker = new Docker();
      const container = docker.getContainer(containerId);
      
      const exec = await container.exec({
        Cmd: ['sh', '-c', 'adb -e shell dumpsys window windows | grep -E "mCurrentFocus|mFocusedApp" | head -1'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const stream = await exec.start({ Detach: false, Tty: false });
      let output = '';
      await new Promise<void>((resolve) => {
        stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        stream.on('end', () => resolve());
        setTimeout(() => resolve(), 3000);
      });
      
      // Extract activity from output (format: "mCurrentFocus=Window{... com.whatsapp/.registration.app.VerifyPhone}")
      const activityMatch = output.match(/com\.whatsapp[^\s}]+/);
      if (activityMatch) {
        const activity = activityMatch[0];
        log(`📱 ADB activity check: ${activity}`);
        return activity;
      }
      
      // Fallback: try simpler command
      const exec2 = await container.exec({
        Cmd: ['sh', '-c', 'adb -e shell dumpsys activity activities | grep "mResumedActivity" | head -1'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const stream2 = await exec2.start({ Detach: false, Tty: false });
      let output2 = '';
      await new Promise<void>((resolve) => {
        stream2.on('data', (chunk: Buffer) => { output2 += chunk.toString(); });
        stream2.on('end', () => resolve());
        setTimeout(() => resolve(), 3000);
      });
      
      const activityMatch2 = output2.match(/com\.whatsapp[^\s}]+/);
      if (activityMatch2) {
        const activity = activityMatch2[0];
        log(`📱 ADB activity check (fallback): ${activity}`);
        return activity;
      }
      
      log(`⚠️ Could not determine activity via ADB`);
      return 'unknown';
    } catch (e: any) {
      log(`⚠️ ADB activity check failed: ${e.message}`);
      return 'unknown';
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
    const { appiumPort, phoneNumber: initialPhoneNumber, sessionId, containerId, vncPort, countryName, buyNumberCallback, onLog, onStateChange } = options;
    
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
        },
      };

              log(`🔌 Connecting to Appium server on host.docker.internal:${appiumPort}...`);
              driver = await remote(opts);
      log(`✅ Connected to Appium server successfully`);
      
      // Capture initial state
      await this.saveScreenshot(driver, '01-connected', sessionId);
      await this.logPageSource(driver, '01-connected', sessionId);

      // Wait for system to stabilize
      log(`⏳ Waiting 5 seconds for system to stabilize...`);
      await this.sleep(5000);

      // Check if WhatsApp needs to be installed
      log(`🔍 Checking if WhatsApp is installed...`);
      let isInstalled = await this.isAppInstalled(driver, 'com.whatsapp');
      
      if (!isInstalled) {
        log(`⚠️ WhatsApp is not installed, attempting automatic installation...`);
        await this.saveScreenshot(driver, 'before-whatsapp-install', sessionId);
        
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
          await this.saveScreenshot(driver, 'error-whatsapp-install-failed', sessionId);
          throw new Error(`WhatsApp installation failed: ${installError.message}. Please install WhatsApp manually in the emulator.`);
        }
      } else {
        log(`✅ WhatsApp is installed, proceeding with automation`);
      }

      // Launch WhatsApp using monkey command directly (most reliable)
      log(`🚀 Launching WhatsApp application...`);
      log(`📦 Package: com.whatsapp`);
      
      log(`🔍 Using monkey command to launch WhatsApp...`);
      try {
        await driver.execute('mobile: shell', {
          command: 'monkey',
          args: ['-p', 'com.whatsapp', '-c', 'android.intent.category.LAUNCHER', '1'],
        });
        log(`✅ Monkey command executed`);
        await this.sleep(3000);
      } catch (error: any) {
        log(`⚠️ Monkey command failed: ${error.message}`);
        // Fallback: try activateApp
        try {
          log(`🔄 Fallback: Trying activateApp...`);
          await driver.activateApp('com.whatsapp');
          log(`✅ activateApp succeeded`);
          await this.sleep(3000);
        } catch (e: any) {
          log(`⚠️ activateApp also failed: ${e.message}`);
        }
      }
      
      // Skip waiting loop - just wait a bit for WhatsApp to launch and get activity
      log(`⏳ Waiting 3 seconds for WhatsApp to launch...`);
      await this.sleep(3000);
      
      let currentActivity = '';
      try {
        currentActivity = await driver.getCurrentActivity();
        log(`📱 Current activity: ${currentActivity}`);
      } catch (e: any) {
        log(`⚠️ Could not get current activity: ${e.message}`);
      }
      
      // Continue with flow regardless of activity (skip waiting loop)
      
      log(`📸 Taking screenshot after WhatsApp launch...`);
      await this.saveScreenshot(driver, '02-whatsapp-launched', sessionId);
      await this.logPageSource(driver, '02-whatsapp-launched', sessionId);
      
      log(`📱 Final activity: ${currentActivity}`);

      // First, check for and dismiss any Alert dialogs that might block the screen
      log(`🔍 Checking for Alert dialogs...`);
      await this.dismissAlerts(driver, log, sessionId);

      // Check if we're on EULA screen and handle it
      if (currentActivity.includes('EULA') || currentActivity.includes('eula')) {
        log(`📜 Detected EULA screen, attempting to accept terms...`);
        await this.saveScreenshot(driver, '02-eula-detected', sessionId);
        await this.handleEULAScreen(driver, log, sessionId, vncPort);
        await this.sleep(3000);
        
        // Re-check activity after accepting EULA
        try {
          currentActivity = await driver.getCurrentActivity();
          log(`📱 Activity after EULA: ${currentActivity}`);
          
          // If still on EULA, wait a bit more and try again
          if (currentActivity.includes('EULA') || currentActivity.includes('eula')) {
            log(`⚠️ Still on EULA, waiting longer and trying one more time...`);
            await this.sleep(5000);
            await this.handleEULAScreen(driver, log, sessionId, vncPort);
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
      await this.enterPhoneNumber(driver, phoneNumber, countryName, log, sessionId, vncPort, containerId);
      
      log(`✅ Phone number ${phoneNumber} entered and submitted successfully`);
      log(`📱 SMS code request should have been sent to WhatsApp`);
      log(`⏳ WhatsApp automation completed - waiting for SMS code...`);
      
      // Take final screenshot
      await this.sleep(2000);
      await this.saveScreenshot(driver, '08-after-phone-entry', sessionId);
      await this.logPageSource(driver, '08-after-phone-entry', sessionId);
      
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
              await this.saveScreenshot(driver, '02-alert-dismissed', sessionId);
              
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
                await this.saveScreenshot(driver, '02-alert-dismissed', sessionId);
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
  private async handleEULAScreen(driver: any, log: (msg: string) => void, sessionId: string, vncPort?: number): Promise<void> {
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
                    await this.saveScreenshot(driver, '04-after-eula', sessionId);
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
                  await this.saveScreenshot(driver, '04-after-eula', sessionId);
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
      
      // FALLBACK: Try clicking via VNC (bypasses anti-bot detection)
      if (vncPort) {
        log(`🖱️ Attempting to click "Agree" button via VNC (port ${vncPort})...`);
        
        try {
          const vncResult = await clickAgreeButtonViaVnc(vncPort, log);
          
          if (vncResult.success) {
            log(`✅ VNC click sent for AGREE button!`);
            await this.sleep(3000);
            
            // Verify page changed
            const activityAfterVnc = await driver.getCurrentActivity().catch(() => 'unknown');
            log(`📱 Activity after VNC AGREE click: ${activityAfterVnc}`);
            
            if (!activityAfterVnc.includes('EULA')) {
              log(`✅ VNC click worked! EULA passed, now on: ${activityAfterVnc}`);
              await this.saveScreenshot(driver, '04-after-eula-vnc', sessionId);
              return;
            }
          } else {
            log(`⚠️ VNC click failed: ${vncResult.error}`);
          }
        } catch (vncError: any) {
          log(`⚠️ VNC click error: ${vncError.message}`);
        }
      }
      
      log(`⚠️ Could not automatically accept EULA, proceeding anyway - may need manual intervention`);
      await this.saveScreenshot(driver, '03-eula-unable-to-accept', sessionId);
    } catch (error: any) {
      log(`❌ Error handling EULA screen: ${error.message}`);
      await this.saveScreenshot(driver, '03-eula-error', sessionId);
      // Don't throw - continue anyway
    }
  }

  /**
   * Handle phone number confirmation dialog "Is this the correct number?"
   */
  private async handlePhoneConfirmationDialog(driver: any, log: (msg: string) => void, sessionId: string): Promise<boolean> {
    try {
      log(`🔍 Checking for phone number confirmation dialog...`);
      
      // First, take a screenshot to see current screen
      await this.saveScreenshot(driver, 'confirmation-dialog-check', sessionId);
      
      // Look for "Yes" button in confirmation dialog
      const yesSelectors = [
        '//android.widget.Button[@text="Yes"]',
        '//android.widget.Button[@text="YES"]',
        '//*[@text="Yes"]',
        '//*[@text="YES"]',
        '//*[@content-desc="Yes"]',
        '//*[@content-desc="YES"]',
      ];
      
      log(`🔍 Trying ${yesSelectors.length} specific "Yes" selectors...`);
      for (let i = 0; i < yesSelectors.length; i++) {
        const selector = yesSelectors[i];
        try {
          log(`   [${i+1}/${yesSelectors.length}] Trying: ${selector}`);
          const yesButton = await driver.$(selector);
          const exists = await yesButton.isExisting();
          
          if (exists) {
            const isDisplayed = await yesButton.isDisplayed().catch(() => false);
            if (isDisplayed) {
              const buttonText = await yesButton.getText().catch(() => '');
              log(`✅ Found confirmation dialog with "${buttonText}" button using selector: ${selector}`);
              log(`🖱️ Clicking "Yes" button now...`);
              await yesButton.click();
              await this.sleep(2000);
              log(`✅ Phone number confirmation dialog dismissed`);
              await this.saveScreenshot(driver, '05-confirmation-yes-clicked', sessionId);
              return true;
            } else {
              log(`   ❌ Element exists but not displayed`);
            }
          } else {
            log(`   ❌ Element not found`);
          }
        } catch (e: any) {
          log(`   ⚠️ Error: ${e.message}`);
          // Continue to next selector
        }
      }
      
      // Also try scanning all buttons for "Yes"
      log(`🔍 Scanning ALL buttons on screen for "Yes"...`);
      try {
        const allButtons = await driver.$$('android.widget.Button');
        log(`📊 Found ${allButtons.length} buttons total`);
        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          try {
            const btn = allButtons[i];
            const exists = await btn.isExisting();
            if (exists) {
              const isDisplayed = await btn.isDisplayed().catch(() => false);
              const text = await btn.getText().catch(() => '');
              log(`   Button #${i}: text="${text}", displayed=${isDisplayed}`);
              
              // Look for "Yes" button (skip "Edit")
              if (isDisplayed && text && text.toUpperCase() === 'YES') {
                log(`✅ Found "Yes" button (#${i}): "${text}", clicking to confirm phone number...`);
                await btn.click();
                await this.sleep(2000);
                log(`✅ Phone number confirmed`);
                await this.saveScreenshot(driver, '05-confirmation-yes-clicked', sessionId);
                return true;
              }
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e: any) {
        log(`⚠️ Could not scan buttons for confirmation: ${e.message}`);
      }
      
      log(`ℹ️ No phone number confirmation dialog found after checking all methods`);
      return false;
    } catch (error: any) {
      log(`⚠️ Error checking for confirmation dialog: ${error.message}`);
      return false;
    }
  }

  /**
   * Enter phone number in WhatsApp registration screen
   */
  private async enterPhoneNumber(driver: any, phoneNumber: string, countryName?: string, onLog?: (msg: string) => void, sessionId?: string, vncPort?: number, containerId?: string): Promise<void> {
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
        if (sessionId) await this.saveScreenshot(driver, 'before-phone-entry', sessionId);
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
        await this.logPageSource(driver, '05-after-phone-entry', sessionId || 'unknown');

        // Check for confirmation dialog "Is this the correct number?" first
        log(`🔍 [STEP 5a] Checking for phone number confirmation dialog...`);
        const confirmationDismissed = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
        
        if (confirmationDismissed) {
          log(`✅ Phone number confirmation dialog handled, waiting for SMS...`);
          await this.sleep(3000);
          await this.saveScreenshot(driver, '06-after-confirmation', sessionId || 'unknown');
          return; // SMS request should be sent now
        }

        // ============================================
        // STRATÉGIE: ENTER d'abord (impossible à bloquer), puis autres méthodes
        // ============================================
        log(`🔍 [STEP 5] Trying to submit phone number...`);
        
        let buttonFound = false;
        
        // METHODE 0a: Essayer la touche ENTER pour valider le formulaire
        // WhatsApp ne peut PAS bloquer les touches clavier standard!
        log(`⌨️ [METHOD 0a] Trying ENTER key to submit form...`);
        try {
          // KEYCODE_ENTER = 66
          await driver.pressKeyCode(66);
          log(`✅ ENTER key (66) pressed!`);
          await this.sleep(2000);
          
          // Check if it worked
          const activityAfterEnter = await driver.getCurrentActivity().catch(() => 'unknown');
          log(`📱 Activity after ENTER: ${activityAfterEnter}`);
          
          // Check for confirmation dialog
          const confirmAfterEnter = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
          if (confirmAfterEnter) {
            log(`✅ ENTER worked! Confirmation dialog appeared and handled!`);
            return;
          }
          
          if (!activityAfterEnter.includes('RegisterPhone') && !activityAfterEnter.includes('EULA')) {
            log(`✅ ENTER worked! Page changed to: ${activityAfterEnter}`);
            return;
          }
        } catch (e: any) {
          log(`⚠️ ENTER key failed: ${e.message}`);
        }
        
        // METHODE 0b: Essayer TAB puis ENTER (pour sélectionner le bouton puis l'activer)
        log(`⌨️ [METHOD 0b] Trying TAB + ENTER...`);
        try {
          await driver.pressKeyCode(61); // KEYCODE_TAB
          log(`✅ TAB key pressed`);
          await this.sleep(500);
          await driver.pressKeyCode(66); // KEYCODE_ENTER
          log(`✅ ENTER key pressed after TAB`);
          await this.sleep(2000);
          
          const activityAfterTabEnter = await driver.getCurrentActivity().catch(() => 'unknown');
          const confirmAfterTab = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
          if (confirmAfterTab || (!activityAfterTabEnter.includes('RegisterPhone') && !activityAfterTabEnter.includes('EULA'))) {
            log(`✅ TAB+ENTER worked!`);
            return;
          }
        } catch (e: any) {
          log(`⚠️ TAB+ENTER failed: ${e.message}`);
        }
        
        // METHODE 0c: Essayer l'action IME "Done" ou "Go"
        log(`⌨️ [METHOD 0c] Trying IME action (performEditorAction)...`);
        try {
          // IME_ACTION_DONE = 6, IME_ACTION_GO = 2, IME_ACTION_NEXT = 5
          // Via ADB: input keyevent 66 ou via shell am broadcast
          if (containerId) {
            const container = (await import('dockerode')).default ? 
              new (await import('dockerode')).default().getContainer(containerId) : null;
            
            if (container) {
              // Try sending IME action via ADB
              const imeCmd = `adb -e shell input keyevent 66`;
              log(`📱 Sending IME action via ADB: ${imeCmd}`);
              
              const exec = await container.exec({
                Cmd: ['sh', '-c', imeCmd],
                AttachStdout: true,
                AttachStderr: true,
              });
              const stream = await exec.start({ Detach: false, Tty: false });
              let output = '';
              await new Promise<void>((resolve) => {
                stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
                stream.on('end', () => resolve());
                setTimeout(() => resolve(), 3000);
              });
              log(`📋 ADB IME result: ${output.trim() || 'sent'}`);
              await this.sleep(2000);
              
              const activityAfterIme = await driver.getCurrentActivity().catch(() => 'unknown');
              const confirmAfterIme = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmAfterIme || (!activityAfterIme.includes('RegisterPhone') && !activityAfterIme.includes('EULA'))) {
                log(`✅ IME action worked!`);
                return;
              }
            }
          }
        } catch (e: any) {
          log(`⚠️ IME action failed: ${e.message}`);
        }
        
        log(`⚠️ Keyboard methods didn't work, trying click methods...`);
        
        // Fermer le clavier pour révéler le bouton NEXT
        log(`⌨️ Closing keyboard to reveal NEXT button...`);
        try {
          await driver.pressKeyCode(4); // KEYCODE_BACK - ferme le clavier
          log(`✅ Back key pressed (keyboard should close)`);
          await this.sleep(2000); // Wait 2s for keyboard animation to complete
          
          // Scroll down to ensure NEXT button is fully visible
          log(`📜 Scrolling down to reveal NEXT button...`);
          try {
            const { width, height } = await driver.getWindowRect();
            // Scroll from middle to top to reveal bottom content
            await driver.touchAction([
              { action: 'press', x: Math.round(width / 2), y: Math.round(height * 0.7) },
              { action: 'wait', ms: 200 },
              { action: 'moveTo', x: Math.round(width / 2), y: Math.round(height * 0.3) },
              { action: 'release' }
            ]);
            log(`✅ Scroll completed`);
            await this.sleep(1000); // Wait for scroll to settle
          } catch (scrollErr: any) {
            log(`⚠️ Scroll failed (might not be needed): ${scrollErr.message}`);
          }
        } catch (e: any) {
          log(`⚠️ Could not press back key: ${e.message}`);
        }
        
        // ETAPE 1: Trouver le bouton NEXT et obtenir ses coordonnées exactes
        log(`🔍 Finding NEXT button and getting its exact coordinates...`);
        
        const buttonSelectors = [
          '//android.widget.Button[@text="NEXT"]',
          '//android.widget.Button[@text="Next"]',
          '//android.widget.Button[contains(@text, "NEXT")]',
          '//*[@content-desc="Next"]',
        ];
        
        let buttonX = 540;  // Default center
        let buttonY = 1656; // Default bottom
        
        // First, check if we have learned coordinates from manual clicks
        try {
          const learnedCoords = await getLearnedClick('NEXT');
          if (learnedCoords) {
            buttonX = learnedCoords.x;
            buttonY = learnedCoords.y;
            log(`📚 Using learned coordinates from manual clicks: (${buttonX}, ${buttonY})`);
          } else {
            log(`ℹ️ No learned coordinates found, will detect from Appium`);
          }
        } catch (error: any) {
          log(`⚠️ Could not get learned coordinates: ${error.message}, will detect from Appium`);
        }
        
        // If no learned coordinates, try to detect from Appium
        if (buttonX === 540 && buttonY === 1656) {
          for (const buttonSelector of buttonSelectors) {
            try {
              const button = await driver.$(buttonSelector);
              const exists = await button.isExisting();
              
              if (exists) {
                // Get button's exact location and size
                try {
                  const location = await button.getLocation();
                  const size = await button.getSize();
                  buttonX = Math.round(location.x + size.width / 2);
                  buttonY = Math.round(location.y + size.height / 2);
                  log(`📍 NEXT button found at: (${buttonX}, ${buttonY}) - size: ${size.width}x${size.height}`);
                } catch (locError: any) {
                  log(`⚠️ Could not get button location: ${locError.message}, using defaults`);
                }
                break;
              }
            } catch (e: any) {
              continue;
            }
          }
        }
        
        log(`🎯 Target coordinates for click: (${buttonX}, ${buttonY})`);
        
        // =========================================================================
        // METHODE VNC: Click via VNC first (uses learned coords 540,1656 or detected)
        // =========================================================================
        if (!buttonFound && vncPort) {
          log(`🖱️ [VNC] Clicking NEXT via VNC at (${buttonX}, ${buttonY})...`);
          try {
            const vncResult = await clickViaVnc(vncPort, buttonX, buttonY, log);
            if (vncResult?.success) {
              log(`✅ VNC click sent!`);
              await this.sleep(2000);
              for (let retry = 0; retry < 3; retry++) {
                const confirmationDismissed = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
                if (confirmationDismissed) {
                  log(`✅ Phone confirmation dialog handled after VNC click!`);
                  buttonFound = true;
                  break;
                }
                await this.sleep(1000);
              }
              if (!buttonFound) {
                const activityAfterVnc = await driver.getCurrentActivity().catch(() => 'unknown');
                if (activityAfterVnc === 'unknown' && containerId) {
                  const activityAdb = await this.getCurrentActivityViaAdb(containerId, log);
                  if (!activityAdb.includes('RegisterPhone') && !activityAdb.includes('EULA')) {
                    log(`✅ VNC click worked! Page changed to: ${activityAdb}`);
                    buttonFound = true;
                  }
                } else if (!activityAfterVnc.includes('RegisterPhone') && !activityAfterVnc.includes('EULA')) {
                  log(`✅ VNC click worked! Page changed to: ${activityAfterVnc}`);
                  buttonFound = true;
                }
              }
            }
          } catch (e: any) {
            log(`⚠️ VNC click failed: ${e.message}, trying ADB...`);
          }
        }
        
        // =========================================================================
        // METHODE 0: Multiple ADB tap methods with delays (PRIORITE TRES HAUTE)
        // Essayer plusieurs méthodes ADB avec des délais réalistes
        // =========================================================================
        if (!buttonFound && containerId) {
          log(`📱 [METHODE 0] Multiple ADB tap attempts at (${buttonX}, ${buttonY})...`);
          try {
            const Docker = (await import('dockerode')).default;
            const docker = new Docker();
            const container = docker.getContainer(containerId);
            
            // Method 0a: input tap with delay
            log(`   📱 Attempt 0a: input tap...`);
            const exec0a = await container.exec({
              Cmd: ['sh', '-c', `adb -e shell input tap ${buttonX} ${buttonY}`],
              AttachStdout: true,
              AttachStderr: true,
            });
            await exec0a.start({ Detach: false, Tty: false });
            await this.sleep(500);
            
            // Method 0b: input touchscreen tap
            log(`   📱 Attempt 0b: touchscreen tap...`);
            const exec0b = await container.exec({
              Cmd: ['sh', '-c', `adb -e shell input touchscreen tap ${buttonX} ${buttonY}`],
              AttachStdout: true,
              AttachStderr: true,
            });
            await exec0b.start({ Detach: false, Tty: false });
            await this.sleep(500);
            
            // Method 0c: swipe (tap via swipe)
            log(`   📱 Attempt 0c: swipe tap...`);
            const exec0c = await container.exec({
              Cmd: ['sh', '-c', `adb -e shell input swipe ${buttonX} ${buttonY} ${buttonX} ${buttonY} 100`],
              AttachStdout: true,
              AttachStderr: true,
            });
            await exec0c.start({ Detach: false, Tty: false });
            await this.sleep(500);
            
            log(`✅ Multiple ADB taps sent!`);
            await this.sleep(2000);
            
            // Check for confirmation dialog
            for (let retry = 0; retry < 3; retry++) {
              const confirmationDismissed = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmationDismissed) {
                log(`✅ Phone confirmation dialog handled after ADB taps!`);
                buttonFound = true;
                break;
              }
              await this.sleep(1000);
            }
            
            // Check if page changed
            if (!buttonFound) {
              let activityAfterAdb = await driver.getCurrentActivity().catch(() => 'unknown');
              log(`📱 Activity after ADB taps (Appium): ${activityAfterAdb}`);
              
              if (activityAfterAdb === 'unknown' && containerId) {
                log(`📱 Appium session terminated, checking activity via ADB...`);
                activityAfterAdb = await this.getCurrentActivityViaAdb(containerId, log);
              }
              
              if (!activityAfterAdb.includes('RegisterPhone') && !activityAfterAdb.includes('EULA') && activityAfterAdb !== 'unknown') {
                log(`✅ ADB taps worked! Page changed to: ${activityAfterAdb}`);
                buttonFound = true;
              }
            }
          } catch (e: any) {
            log(`⚠️ ADB taps failed: ${e.message}`);
          }
        }
        
        // =========================================================================
        // METHODE 1: xdotool INSTALL + CLICK (PRIORITE HAUTE)
        // xdotool n'est pas installé par défaut dans le container émulateur.
        // On l'installe d'abord, puis on clique via XTEST extension de X11.
        // =========================================================================
        if (!buttonFound && containerId) {
          log(`🖱️ [METHODE 1] xdotool install + click at (${buttonX}, ${buttonY})...`);
          log(`📦 This will install xdotool in emulator container if needed`);
          
          const xdotoolResult = await clickViaXdotoolWithWindowDetection(containerId, buttonX, buttonY, log);
          
          if (xdotoolResult.success) {
            log(`✅ xdotool click sent!`);
            await this.sleep(3000);
            
            // Check for confirmation dialog
            for (let retry = 0; retry < 3; retry++) {
              const confirmationDismissed2 = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmationDismissed2) {
                log(`✅ Phone confirmation dialog handled after xdotool!`);
                buttonFound = true;
                break;
              }
              await this.sleep(1000);
            }
            
            // Check if page changed
            if (!buttonFound) {
              let activityAfterXdo = await driver.getCurrentActivity().catch(() => 'unknown');
              log(`📱 Activity after xdotool click (Appium): ${activityAfterXdo}`);
              
              // If Appium session is terminated, check via ADB
              if (activityAfterXdo === 'unknown' && containerId) {
                log(`📱 Appium session terminated, checking activity via ADB...`);
                activityAfterXdo = await this.getCurrentActivityViaAdb(containerId, log);
              }
              
              if (!activityAfterXdo.includes('RegisterPhone') && !activityAfterXdo.includes('EULA') && activityAfterXdo !== 'unknown') {
                log(`✅ xdotool click worked! Page changed to: ${activityAfterXdo}`);
                buttonFound = true;
              } else if (activityAfterXdo === 'unknown') {
                log(`⚠️ Could not determine activity - assuming click may have worked, continuing...`);
                // Don't set buttonFound = true for unknown, but don't fail either
              }
            }
          } else {
            log(`⚠️ xdotool failed: ${xdotoolResult.error}`);
          }
        }
        
        // =========================================================================
        // METHODE 2: Native VNC/RFB (connexion directe via Docker network)
        // =========================================================================
        if (!buttonFound && containerId) {
          log(`🔌 [METHODE 2] Native VNC via Docker network at (${buttonX}, ${buttonY})...`);
          
          const nativeVncResult = await clickViaNativeVnc(containerId, buttonX, buttonY, log);
          
          if (nativeVncResult.success) {
            log(`✅ Native VNC click sent via RFB protocol!`);
            await this.sleep(3000);
            
            // Check for confirmation dialog
            for (let retry = 0; retry < 3; retry++) {
              const confirmationDismissed2 = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmationDismissed2) {
                log(`✅ Phone confirmation dialog handled after Native VNC!`);
                buttonFound = true;
                break;
              }
              await this.sleep(1000);
            }
            
            // Check if page changed
            if (!buttonFound) {
              let activityAfterNativeVnc = await driver.getCurrentActivity().catch(() => 'unknown');
              log(`📱 Activity after Native VNC click (Appium): ${activityAfterNativeVnc}`);
              
              if (activityAfterNativeVnc === 'unknown' && containerId) {
                log(`📱 Appium session terminated, checking activity via ADB...`);
                activityAfterNativeVnc = await this.getCurrentActivityViaAdb(containerId, log);
              }
              
              if (!activityAfterNativeVnc.includes('RegisterPhone') && !activityAfterNativeVnc.includes('EULA') && activityAfterNativeVnc !== 'unknown') {
                log(`✅ Native VNC click worked! Page changed to: ${activityAfterNativeVnc}`);
                buttonFound = true;
              }
            }
          } else {
            log(`⚠️ Native VNC failed: ${nativeVncResult.error}`);
          }
        }
        
        // =========================================================================
        // METHODE 2: noVNC via Puppeteer (si Native VNC a échoué)
        // =========================================================================
        if (!buttonFound && vncPort) {
          log(`🔄 [METHODE 2] noVNC via Puppeteer at (${buttonX}, ${buttonY})...`);
          log(`🖱️ VNC port: ${vncPort}`);
          
          const vncResult = await clickViaVnc(vncPort, buttonX, buttonY, log);
          
          if (vncResult.success) {
            log(`✅ noVNC click sent!`);
            await this.sleep(3000);
            
            // Check for confirmation dialog
            for (let retry = 0; retry < 3; retry++) {
              const confirmationDismissed2 = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmationDismissed2) {
                log(`✅ Phone confirmation dialog handled after noVNC!`);
                buttonFound = true;
                break;
              }
              await this.sleep(1000);
            }
            
            // Check if page changed
            if (!buttonFound) {
              let activityAfterVnc = await driver.getCurrentActivity().catch(() => 'unknown');
              log(`📱 Activity after noVNC click (Appium): ${activityAfterVnc}`);
              
              if (activityAfterVnc === 'unknown' && containerId) {
                log(`📱 Appium session terminated, checking activity via ADB...`);
                activityAfterVnc = await this.getCurrentActivityViaAdb(containerId, log);
              }
              
              if (!activityAfterVnc.includes('RegisterPhone') && !activityAfterVnc.includes('EULA') && activityAfterVnc !== 'unknown') {
                log(`✅ noVNC click worked! Page changed to: ${activityAfterVnc}`);
                buttonFound = true;
              }
            }
          } else {
            log(`❌ noVNC click failed: ${vncResult.error}`);
          }
        }
        
        // =========================================================================
        // METHODE 3: xdotool + ADB tap (commandes internes au container)
        // =========================================================================
        if (!buttonFound && containerId) {
          log(`🔄 [METHODE 3] ADB/xdotool tap at (${buttonX}, ${buttonY})...`);
          
          const adbResult = await clickViaAdb(containerId, buttonX, buttonY, log);
          
          if (adbResult.success) {
            log(`✅ ADB/xdotool tap sent!`);
            await this.sleep(3000);
            
            // Check for confirmation dialog
            for (let retry = 0; retry < 3; retry++) {
              const confirmationDismissed2 = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
              if (confirmationDismissed2) {
                log(`✅ Phone confirmation dialog handled after ADB!`);
                buttonFound = true;
                break;
              }
              await this.sleep(1000);
            }
            
            // Check if page changed
            if (!buttonFound) {
              let activityAfterAdb = await driver.getCurrentActivity().catch(() => 'unknown');
              log(`📱 Activity after ADB click (Appium): ${activityAfterAdb}`);
              
              if (activityAfterAdb === 'unknown' && containerId) {
                log(`📱 Appium session terminated, checking activity via ADB...`);
                activityAfterAdb = await this.getCurrentActivityViaAdb(containerId, log);
              }
              
              if (!activityAfterAdb.includes('RegisterPhone') && !activityAfterAdb.includes('EULA') && activityAfterAdb !== 'unknown') {
                log(`✅ ADB click worked! Page changed to: ${activityAfterAdb}`);
                buttonFound = true;
              }
            }
          } else {
            log(`❌ ADB tap failed: ${adbResult.error}`);
          }
        }
        
        // =========================================================================
        // METHODE 4: Appium click (dernière option - souvent bloquée par anti-bot)
        // =========================================================================
        if (!buttonFound) {
          log(`🔄 [METHODE 4] Appium click (last resort)...`);
          
          for (const buttonSelector of buttonSelectors) {
            try {
              const button = await driver.$(buttonSelector);
              const exists = await button.isExisting();
              
              if (exists) {
                log(`🖱️ Trying Appium click on NEXT button...`);
                await button.click();
                log(`✅ Appium click sent!`);
                await this.sleep(3000);
                
                // Check for confirmation dialog
                for (let retry = 0; retry < 3; retry++) {
                  const confirmationDismissed2 = await this.handlePhoneConfirmationDialog(driver, log, sessionId || 'unknown');
                  if (confirmationDismissed2) {
                    log(`✅ Phone confirmation dialog handled!`);
                    buttonFound = true;
                    break;
                  }
                  await this.sleep(1000);
                }
                
                // Check if page changed
                if (!buttonFound) {
                  let activityAfter = await driver.getCurrentActivity().catch(() => 'unknown');
                  log(`📱 Activity after Appium click (Appium): ${activityAfter}`);
                  
                  if (activityAfter === 'unknown' && containerId) {
                    log(`📱 Appium session terminated, checking activity via ADB...`);
                    activityAfter = await this.getCurrentActivityViaAdb(containerId, log);
                  }
                  
                  if (!activityAfter.includes('RegisterPhone') && !activityAfter.includes('EULA') && activityAfter !== 'unknown') {
                    log(`✅ Appium click worked! Page changed to: ${activityAfter}`);
                    buttonFound = true;
                  }
                }
                
                if (buttonFound) break;
              }
            } catch (e: any) {
              log(`⚠️ Appium selector ${buttonSelector} failed: ${e.message}`);
              continue;
            }
          }
        }
        
        // Final check - verify activity via ADB if Appium session is terminated
        if (!buttonFound && containerId) {
          log(`📱 Final verification: checking activity via ADB...`);
          const finalActivity = await this.getCurrentActivityViaAdb(containerId, log);
          
          if (!finalActivity.includes('RegisterPhone') && !finalActivity.includes('EULA') && finalActivity !== 'unknown') {
            log(`✅ Final ADB check: Page changed to ${finalActivity} - click succeeded!`);
            buttonFound = true;
          }
        }
        
        // Final check - if still no button found
        if (!buttonFound) {
          log(`❌ Could not click "Next" button with any method (VNC+OCR, ADB, Appium).`);
          await this.saveScreenshot(driver, '08-all-methods-failed', sessionId || 'unknown').catch(() => {});
          await this.logPageSource(driver, '08-all-methods-failed', sessionId || 'unknown').catch(() => {});
          throw new Error('Failed to submit phone number - Next button click did not work with any method');
        }
        
        log(`✅ Phone number submission completed successfully!`);
        await this.saveScreenshot(driver, '07-sms-waiting-screen', sessionId || 'unknown').catch(() => {});
        
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
          await this.saveScreenshot(driver, 'play-store-wait', sessionId); // Use sessionId to avoid TS error
          
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
      const apkUrl = 'https://www.whatsapp.com/android/current/WhatsApp.apk';
      
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
        await this.sleep(5000); // Wait for installation to complete
        
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

      await this.sleep(3000);
      
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
        await this.saveScreenshot(driver, 'otp-screen-no-input', sessionId);
        await this.logPageSource(driver, 'otp-screen-no-input', sessionId);
        throw new Error('Could not find OTP input field after waiting 60 seconds. The "Verifying your number" screen may not have appeared.');
      }

      log(`✅ OTP verification screen is visible, input field found!`);
      await this.saveScreenshot(driver, 'otp-screen-found', sessionId);
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
      await this.saveScreenshot(driver, 'otp-entered', sessionId);

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

      await this.saveScreenshot(driver, 'otp-after-verify', sessionId);
      log(`✅ Verification button clicked`);

      // Wait for OTP verification to complete - look for "Verified" status
      log(`⏳ Waiting for OTP verification to complete (looking for "Verified" status)...`);
      const maxVerifyWaitTime = 30000; // 30 seconds max wait
      const verifyCheckInterval = 2000; // Check every 2 seconds
      const verifyStartTime = Date.now();
      let verificationComplete = false;

      while (Date.now() - verifyStartTime < maxVerifyWaitTime && !verificationComplete) {
        await this.sleep(verifyCheckInterval);
        await this.saveScreenshot(driver, `otp-verify-wait-${Date.now()}`, sessionId);

        // Look for "Verified" text or status indicator
        const verifiedIndicators = [
          '//*[contains(@text, "Verified")]',
          '//*[contains(@text, "VERIFIED")]',
          '//*[contains(@content-desc, "Verified")]',
          '//*[@resource-id="com.whatsapp:id/verification_status"]',
        ];

        for (const selector of verifiedIndicators) {
          try {
            const verifiedElement = await driver.$(selector);
            const exists = await verifiedElement.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await verifiedElement.isDisplayed().catch(() => false);
              if (isDisplayed) {
                const text = await verifiedElement.getText().catch(() => '');
                if (text.toLowerCase().includes('verified')) {
                  log(`✅ OTP verification complete! Found "Verified" status`);
                  verificationComplete = true;
                  await this.saveScreenshot(driver, 'otp-verified', sessionId);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }

        // Also check if we've moved to the next screen (profile setup)
        if (!verificationComplete) {
          try {
            const currentActivity = await driver.getCurrentActivity();
            if (currentActivity && (
              currentActivity.includes('profile') || 
              currentActivity.includes('name') ||
              currentActivity.includes('setup')
            )) {
              log(`✅ Moved to profile setup screen, verification likely complete`);
              verificationComplete = true;
              break;
            }
          } catch (e) {
            // Ignore activity check errors
          }
        }
      }

      if (!verificationComplete) {
        log(`⚠️ Could not confirm "Verified" status, but proceeding with next steps...`);
      } else {
        log(`✅ OTP code verified successfully`);
      }

      // Wait a bit more for WhatsApp to process OTP and show next screen (profile setup or main chat)
      log(`⏳ Waiting for WhatsApp to transition to next screen...`);
      await this.sleep(3000);

      // Check what screen we're on now
      try {
        const currentActivity = await driver.getCurrentActivity();
        log(`📱 Current activity after OTP: ${currentActivity}`);
        await this.saveScreenshot(driver, 'after-otp-verification', sessionId);
      } catch (e) {
        // Ignore
      }
      
      // Detect screen after OTP injection
      log(`🔍 ==== AFTER OTP INJECTION - DETECTING SCREEN ====`);
      const screenAfterOtp = await this.detectCurrentScreen(driver, log);
      log(`🖥️ Screen after OTP: ${screenAfterOtp}`);

      // Complete profile setup if needed (name, photo)
      // Note: Contact permission popup is handled inside completeProfileSetup now
      log(`🔧 Completing profile setup (including permissions and profile info)...`);
      await this.completeProfileSetup(driver, log, sessionId);

      // Handle "Test message" screen - WhatsApp may ask to send a test message
      log(`🔍 Checking for test message screen...`);
      await this.handleTestMessageScreen(driver, log, sessionId);
      
      // Check for Profile info again (can appear after test message)
      log(`🔍 Checking for Profile info again (after test message)...`);
      await this.handleProfileInfoScreen(driver, log, sessionId);

      // Handle "Restore a backup" screen - WhatsApp may ask to restore from Google
      log(`🔍 Checking for restore backup screen...`);
      await this.handleRestoreBackupScreen(driver, log, sessionId);
      
      // Check for Profile info again (can appear after restore backup)
      log(`🔍 Checking for Profile info again (after restore backup)...`);
      await this.handleProfileInfoScreen(driver, log, sessionId);

      log(`🔍 Checking for email screen...`);
      await this.handleEmailScreen(driver, log, sessionId);

      // NOTE: We now skip the email screen directly, so no Help popup or email verification screens appear
      // If email was skipped, we're done. If email was filled, check for potential issues:
      log(`🔍 Checking for "Help" popup after email (if email was filled)...`);
      await this.handleHelpPopupAndResubmit(driver, log, sessionId);

      log(`🔍 Checking for email verification screen (if email was filled)...`);
      await this.handleEmailVerificationScreen(driver, log, sessionId);

      // Wait for WhatsApp to fully initialize (shorter wait since we skip email now)
      log(`⏳ Waiting for WhatsApp to complete activation (5 seconds)...`);
      await this.sleep(5000); // Reduced from 10s to 5s since we skip email directly

      // Try to verify WhatsApp activation with retries
      log(`🔍 Verifying WhatsApp activation...`);
      let isActivated = false;
      let retryCount = 0;
      const maxRetries = 3;
      
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
        await this.saveScreenshot(driver, 'whatsapp-activated', sessionId);
      } else {
        log(`⚠️ Could not verify WhatsApp activation after ${maxRetries} attempts`);
        log(`ℹ️ WhatsApp may still be loading or on an unexpected screen`);
        await this.saveScreenshot(driver, 'whatsapp-not-activated', sessionId);
        
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
        await this.saveScreenshot(driver, 'otp-injection-error', sessionId);
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
   * Handle "Restore a backup" screen - click "Cancel" to skip
   */
  private async handleRestoreBackupScreen(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      await this.sleep(2000);
      
      // Look for text that indicates we're on the restore backup screen
      const restoreBackupIndicators = [
        '//*[contains(@text, "Restore a backup")]',
        '//*[contains(@text, "Restore backup")]',
        '//*[contains(@text, "restore your backup")]',
        '//*[contains(@text, "Google storage")]',
      ];

      let onRestoreScreen = false;
      for (const selector of restoreBackupIndicators) {
        try {
          const element = await driver.$(selector);
          const exists = await element.isExisting().catch(() => false);
          if (exists) {
            onRestoreScreen = true;
            log(`✅ Found restore backup screen`);
            await this.saveScreenshot(driver, 'restore-backup-screen', sessionId);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (onRestoreScreen) {
        // Look for "Cancel" button
        log(`🔍 Looking for Cancel button on restore backup screen...`);
        const cancelButtonSelectors = [
          '//android.widget.Button[@text="Cancel"]',
          '//android.widget.Button[@text="CANCEL"]',
          '//*[@text="Cancel"]',
          '//*[@text="CANCEL"]',
          '//android.widget.Button[contains(@text, "Cancel")]',
          '//android.widget.Button[contains(@text, "cancel")]',
        ];

        let buttonClicked = false;
        for (const selector of cancelButtonSelectors) {
          try {
            const button = await driver.$(selector);
            const exists = await button.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await button.isDisplayed().catch(() => false);
              if (isDisplayed) {
                log(`✅ Found Cancel button on restore backup screen, clicking...`);
                await button.click();
                await this.sleep(2000);
                log(`✅ Restore backup screen skipped (Cancel clicked)`);
                buttonClicked = true;
                await this.saveScreenshot(driver, 'after-restore-cancel', sessionId);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!buttonClicked) {
          log(`⚠️ Cancel button not found by selector, trying all buttons...`);
          try {
            const allButtons = await driver.$$('//android.widget.Button');
            for (const btn of allButtons) {
              try {
                const text = await btn.getText().catch(() => '');
                if (text.toLowerCase().includes('cancel')) {
                  log(`✅ Found Cancel button by text, clicking...`);
                  await btn.click();
                  await this.sleep(2000);
                  log(`✅ Restore backup screen skipped (Cancel clicked)`);
                  await this.saveScreenshot(driver, 'after-restore-cancel', sessionId);
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            log(`⚠️ Alternative button search failed`);
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
      await this.saveScreenshot(driver, 'check-test-message-screen', sessionId);
      
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
        await this.saveScreenshot(driver, 'test-message-screen-detected', sessionId);
        
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
                    await this.saveScreenshot(driver, 'after-test-message', sessionId);
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
                  await this.saveScreenshot(driver, 'after-test-message', sessionId);
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
          await this.saveScreenshot(driver, 'test-message-no-next-found', sessionId);
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
      
      await this.saveScreenshot(driver, 'check-email-screen', sessionId);
      
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
          await this.saveScreenshot(driver, 'after-keyboard-closed', sessionId);
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
            await this.saveScreenshot(driver, 'after-tap-outside-keyboard', sessionId);
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
                await this.saveScreenshot(driver, 'after-email-skip', sessionId);
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
                  await this.saveScreenshot(driver, 'after-email-entry', sessionId);
                  
                  // CRITICAL: Hide keyboard to reveal the submit button (blue checkmark)
                  log(`⌨️ Hiding keyboard to reveal submit button...`);
                  try {
                    await driver.hideKeyboard();
                    await this.sleep(1000);
                    log(`✅ Keyboard hidden successfully`);
                    await this.saveScreenshot(driver, 'after-keyboard-hidden', sessionId);
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
                      await this.saveScreenshot(driver, 'after-email-next', sessionId);
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
                      await this.saveScreenshot(driver, 'after-email-next', sessionId);
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
                await this.saveScreenshot(driver, 'after-email-enter', sessionId);
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
      await this.saveScreenshot(driver, 'check-email-verification', sessionId);
      
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
              await this.saveScreenshot(driver, 'email-verification-detected', sessionId);
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
                await this.saveScreenshot(driver, 'after-email-verification-skip', sessionId);
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
      await this.saveScreenshot(driver, 'check-help-popup', sessionId);
      
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
              await this.saveScreenshot(driver, 'help-popup-detected', sessionId);
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
          await this.saveScreenshot(driver, 'help-popup-handled', sessionId);
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
   * Handle contact permission popup - click "Not now" or "Deny" to continue
   */
  private async handleContactPermissionPopup(driver: any, log: (msg: string) => void, sessionId: string): Promise<void> {
    try {
      log(`🔍 Checking for contacts/media permission popup...`);
      await this.sleep(2000);

      // Check if we're on Android permission dialog (GrantPermissionsActivity)
      let currentActivity = '';
      try {
        currentActivity = await driver.execute('mobile: getCurrentActivity');
        log(`📱 Current activity: ${currentActivity}`);
      } catch (e) {
        // Ignore
      }

      const isAndroidPermissionDialog = currentActivity && currentActivity.includes('GrantPermissionsActivity');
      
      if (isAndroidPermissionDialog) {
        log(`✅ Detected Android native permission dialog (GrantPermissionsActivity)`);
        await this.saveScreenshot(driver, 'android-permission-dialog', sessionId);
        
        // Android can show MULTIPLE permission popups in succession
        // We need to handle them in a loop until we're no longer on GrantPermissionsActivity
        let maxRetries = 5; // Handle up to 5 permission popups
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
          retryCount++;
          log(`🔄 Android permission dialog attempt ${retryCount}/${maxRetries}...`);
          
          // Check if we're still on permission dialog
          let checkActivity = '';
          try {
            checkActivity = await driver.execute('mobile: getCurrentActivity');
          } catch (e) {
            checkActivity = currentActivity;
          }
          
          if (!checkActivity.includes('GrantPermissionsActivity')) {
            log(`✅ No longer on GrantPermissionsActivity! Successfully dismissed all permission dialogs.`);
            await this.saveScreenshot(driver, 'all-android-permissions-dismissed', sessionId);
            return; // Success! We're out of the permission loop
          }
          
          log(`📱 Still on: ${checkActivity}`);
          await this.saveScreenshot(driver, `android-permission-attempt-${retryCount}`, sessionId);
          
          // For Android native dialogs, use resource-id selectors
          const androidButtonSelectors = [
            '//*[@resource-id="com.android.permissioncontroller:id/permission_deny_button"]',
            '//android.widget.Button[@text="Deny"]',
            '//android.widget.Button[@text="DENY"]',
            '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
            '//android.widget.Button[@text="Allow"]',
            '//android.widget.Button[@text="ALLOW"]',
            '//*[@text="Deny"]',
            '//*[@text="Allow"]',
          ];
          
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
            // Emergency fallback: find ALL buttons and click the first one that looks like Deny/Allow
            try {
              const allButtons = await driver.$$('//android.widget.Button');
              log(`📊 Found ${allButtons.length} buttons total on Android dialog`);
              for (let i = 0; i < allButtons.length; i++) {
                try {
                  const btn = allButtons[i];
                  const text = await btn.getText().catch(() => '');
                  const exists = await btn.isExisting().catch(() => false);
                  const isDisplayed = exists ? await btn.isDisplayed().catch(() => false) : false;
                  
                  if (isDisplayed && (text.toLowerCase().includes('deny') || text.toLowerCase().includes('allow'))) {
                    log(`🎯 Emergency: Clicking button "${text}" (index ${i})...`);
                    await btn.click();
                    await this.sleep(2000);
                    log(`✅ Emergency click completed`);
                    clicked = true;
                    break;
                  }
                } catch (btnError) {
                  continue;
                }
              }
              
              if (!clicked && allButtons.length > 0) {
                // Last resort: click the last button
                log(`🎯 Last resort: Clicking last button...`);
                await allButtons[allButtons.length - 1].click();
                await this.sleep(2000);
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
          
          // Wait a bit before checking again
          await this.sleep(2000);
        }
        
        log(`⚠️ Exited permission dialog loop after ${retryCount} attempts`);
        await this.saveScreenshot(driver, 'after-android-permission-loop', sessionId);
        return; // Done with Android dialog
      }

      // WhatsApp permission popup (not Android native)
      const permissionDialogSelectors = [
        '//*[contains(@text, "Allow WhatsApp to access your contacts")]',
        '//*[contains(@text, "access your contacts")]',
        '//*[contains(@text, "Contacts and media")]',
        '//*[contains(@text, "photos and media")]',
        '//*[contains(@text, "Allow WhatsApp to access")]',
        '//*[contains(@text, "Allow") and contains(@text, "contacts")]',
        '//*[contains(@text, "Allow") and contains(@text, "photos")]',
        '//*[contains(@text, "contact")]',
        '//*[contains(@text, "media")]',
        '//*[contains(@text, "photos")]',
      ];

      let dialogFound = false;
      for (const selector of permissionDialogSelectors) {
        try {
          const dialog = await driver.$(selector);
          const exists = await dialog.isExisting().catch(() => false);
          if (exists) {
            const isDisplayed = await dialog.isDisplayed().catch(() => false);
            if (isDisplayed) {
              dialogFound = true;
              log(`✅ Found WhatsApp permission popup`);
              await this.saveScreenshot(driver, 'whatsapp-permission-popup', sessionId);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (dialogFound) {
        const dismissButtonSelectors = [
          '//android.widget.Button[@text="Not now"]',
          '//android.widget.Button[@text="NOT NOW"]',
          '//*[@text="Not now"]',
          '//*[@text="NOT NOW"]',
          '//android.widget.Button[contains(@text, "Not now")]',
          '//android.widget.Button[@text="Deny"]',
          '//android.widget.Button[@text="DENY"]',
          '//*[@text="Deny"]',
          '//*[@text="DENY"]',
          '//android.widget.Button[contains(@text, "Deny")]',
        ];

        for (const selector of dismissButtonSelectors) {
          try {
            const dismissButton = await driver.$(selector);
            const exists = await dismissButton.isExisting().catch(() => false);
            if (exists) {
              const isDisplayed = await dismissButton.isDisplayed().catch(() => false);
              if (isDisplayed) {
                const buttonText = await dismissButton.getText().catch(() => '');
                if (buttonText.toLowerCase().includes('not now') || buttonText.toLowerCase().includes('deny')) {
                  log(`🚫 Clicking "${buttonText}" button on WhatsApp permission popup...`);
                  await dismissButton.click();
                  await this.sleep(2000);
                  log(`✅ WhatsApp permission popup dismissed`);
                  await this.saveScreenshot(driver, 'whatsapp-permission-dismissed', sessionId);
                  return;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      } else {
        log(`ℹ️ No permission popup found, continuing...`);
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
      await this.saveScreenshot(driver, 'check-profile-info-screen', sessionId);
      
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
      await this.saveScreenshot(driver, 'profile-info-detected', sessionId);
      
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
      await this.saveScreenshot(driver, 'name-entered', sessionId);
      
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
        await this.saveScreenshot(driver, 'profile-info-completed', sessionId);
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
      await this.detectCurrentScreen(driver, log);
      
      // Take screenshot to see current state
      await this.saveScreenshot(driver, 'profile-setup-start', sessionId);
      log(`📸 Screenshot taken: profile-setup-start`);
      
      // Wait for screen to stabilize
      await this.sleep(2000);
      
      // STEP 1: Handle contacts/media permission popup FIRST
      log(`🔍 STEP 1: Checking for contacts/media permission popup...`);
      await this.handleContactPermissionPopup(driver, log, sessionId);
      
      // STEP 2: Wait for next screen and check if it's Profile info
      log(`🔍 STEP 2: Waiting for next screen after permissions...`);
      await this.sleep(3000);
      await this.saveScreenshot(driver, 'after-permissions', sessionId);
      await this.detectCurrentScreen(driver, log);
      
      // STEP 3: Check if we're on Profile info screen (first check)
      log(`🔍 STEP 3: Checking for Profile info screen (first check)...`);
      await this.handleProfileInfoScreen(driver, log, sessionId);
      
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
        await this.saveScreenshot(driver, 'message-send-error', sessionId);
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
}

export default new WhatsAppAutomationService();
