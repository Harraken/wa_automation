import { remote, RemoteOptions } from 'webdriverio';
import { config } from './config';
import { logger } from './logger';

export class AppiumClient {
  private driver: any = null;

  async connect(): Promise<void> {
    logger.info('Connecting to Appium server');

    const opts: RemoteOptions = {
      hostname: config.appium.host,
      port: config.appium.port,
      path: '/wd/hub',
      logLevel: 'warn',
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'emulator',
        'appium:appPackage': config.whatsapp.packageName,
        'appium:appActivity': config.whatsapp.activityName,
        'appium:noReset': false,
        'appium:fullReset': false,
      },
    };

    this.driver = await remote(opts);
    logger.info('Connected to Appium');
  }

  async isConnected(): Promise<boolean> {
    return this.driver !== null;
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.deleteSession();
      this.driver = null;
      logger.info('Disconnected from Appium');
    }
  }

  /**
   * Launch WhatsApp
   */
  async launchWhatsApp(): Promise<void> {
    logger.info('Launching WhatsApp');
    
    if (!this.driver) {
      throw new Error('Driver not connected');
    }

    // WhatsApp should auto-launch, but we can ensure it's in foreground
    await this.driver.activateApp(config.whatsapp.packageName);
    await this.sleep(3000);
  }

  /**
   * Enter phone number on registration screen
   */
  async enterPhoneNumber(phoneNumber: string): Promise<void> {
    logger.info({ phoneNumber }, 'Entering phone number');

    // Selectors for WhatsApp registration (may need adjustment based on version)
    const selectors = [
      'com.whatsapp:id/registration_phone',
      'com.whatsapp:id/phone_number_input',
      '//android.widget.EditText[@content-desc="Phone number"]',
      '//android.widget.EditText',
    ];

    for (const selector of selectors) {
      try {
        const isResourceId = selector.startsWith('com.whatsapp');
        const element = isResourceId 
          ? await this.driver.$(`android=new UiSelector().resourceId("${selector}")`)
          : await this.driver.$(selector);

        if (await element.isDisplayed()) {
          await element.setValue(phoneNumber);
          logger.info('Phone number entered');
          await this.sleep(1000);
          return;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error('Could not find phone number input field');
  }

  /**
   * Tap "Next" or "Continue" button
   */
  async tapNext(): Promise<void> {
    logger.info('Tapping Next button');

    const selectors = [
      'com.whatsapp:id/registration_submit',
      '//android.widget.Button[@text="Next"]',
      '//android.widget.Button[@text="NEXT"]',
      '//android.widget.Button[@content-desc="Next"]',
      '//android.widget.Button',
    ];

    for (const selector of selectors) {
      try {
        const isResourceId = selector.startsWith('com.whatsapp');
        const element = isResourceId 
          ? await this.driver.$(`android=new UiSelector().resourceId("${selector}")`)
          : await this.driver.$(selector);

        if (await element.isDisplayed()) {
          await element.click();
          logger.info('Next button tapped');
          await this.sleep(2000);
          return;
        }
      } catch (error) {
        continue;
      }
    }

    logger.warn('Could not find Next button, may have auto-progressed');
  }

  /**
   * Inject OTP code
   */
  async injectOtp(otp: string): Promise<void> {
    logger.info({ otp }, 'Injecting OTP');

    // Wait for OTP input to appear
    await this.sleep(3000);

    const selectors = [
      'com.whatsapp:id/verification_code_input',
      'com.whatsapp:id/code_input',
      '//android.widget.EditText[@content-desc="Verification code"]',
      '//android.widget.EditText',
    ];

    for (const selector of selectors) {
      try {
        const isResourceId = selector.startsWith('com.whatsapp');
        const element = isResourceId 
          ? await this.driver.$(`android=new UiSelector().resourceId("${selector}")`)
          : await this.driver.$(selector);

        if (await element.isDisplayed()) {
          await element.setValue(otp);
          logger.info('OTP injected');
          await this.sleep(2000);
          return;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error('Could not find OTP input field');
  }

  /**
   * Complete profile setup (name, photo)
   */
  async completeProfileSetup(name?: string): Promise<void> {
    logger.info('Completing profile setup');

    await this.sleep(3000);

    // Try to find name input
    try {
      const nameInput = await this.driver.$('//android.widget.EditText');
      if (await nameInput.isDisplayed()) {
        await nameInput.setValue(name || 'User');
        await this.sleep(1000);
      }
    } catch (error) {
      logger.warn('Could not find name input, skipping');
    }

    // Tap Next/Done
    await this.tapNext();
    await this.sleep(2000);
  }

  /**
   * Detect if WhatsApp is activated (chat list visible)
   */
  async isActivated(): Promise<boolean> {
    try {
      const chatList = await this.driver.$('com.whatsapp:id/conversations_row_container');
      return await chatList.isDisplayed();
    } catch (error) {
      return false;
    }
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(): Promise<Buffer> {
    if (!this.driver) {
      throw new Error('Driver not connected');
    }

    const screenshot = await this.driver.takeScreenshot();
    return Buffer.from(screenshot, 'base64');
  }

  /**
   * Send a message to a contact
   */
  async sendMessage(to: string, text: string): Promise<void> {
    logger.info({ to, text }, 'Sending message');

    // Open search
    const searchButton = await this.driver.$('com.whatsapp:id/menuitem_search');
    await searchButton.click();
    await this.sleep(1000);

    // Enter contact name/number
    const searchInput = await this.driver.$('com.whatsapp:id/search_src_text');
    await searchInput.setValue(to);
    await this.sleep(2000);

    // Tap first result
    const firstResult = await this.driver.$('com.whatsapp:id/contact_row_container');
    await firstResult.click();
    await this.sleep(1000);

    // Enter message
    const messageInput = await this.driver.$('com.whatsapp:id/entry');
    await messageInput.setValue(text);
    await this.sleep(500);

    // Send
    const sendButton = await this.driver.$('com.whatsapp:id/send');
    await sendButton.click();
    await this.sleep(1000);

    logger.info({ to }, 'Message sent');
  }

  /**
   * Monitor for incoming messages
   */
  async getRecentMessages(): Promise<any[]> {
    // This is a simplified version
    // In production, you'd parse the chat list for new messages
    try {
      const chatRows = await this.driver.$$('com.whatsapp:id/conversations_row_container');
      const messages: any[] = [];

      for (let i = 0; i < Math.min(chatRows.length, 5); i++) {
        const row = chatRows[i];
        try {
          const contactName = await row.$('com.whatsapp:id/conversation_contact_name').getText();
          const messageText = await row.$('com.whatsapp:id/conversation_contact_message').getText();
          
          messages.push({
            from: contactName,
            text: messageText,
            timestamp: new Date(),
          });
        } catch (error) {
          // Skip if can't parse
        }
      }

      return messages;
    } catch (error) {
      logger.error({ error }, 'Failed to get messages');
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}






