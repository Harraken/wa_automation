import { config } from './config';
import { logger } from './logger';
import { AppiumClient } from './appium.client';
import { OCRService } from './ocr.service';
import { WebSocketClient } from './websocket.client';

class WhatsAppAgent {
  private appiumClient: AppiumClient;
  private ocrService: OCRService;
  private wsClient: WebSocketClient;
  private isSetupComplete = false;
  private messagePollingInterval?: NodeJS.Timeout;

  constructor() {
    this.appiumClient = new AppiumClient();
    this.ocrService = new OCRService();
    this.wsClient = new WebSocketClient();
  }

  async start(): Promise<void> {
    logger.info({ 
      sessionId: config.sessionId, 
      phoneNumber: config.phoneNumber 
    }, 'Starting WhatsApp agent');

    try {
      // Connect to Appium
      await this.appiumClient.connect();
      await this.sleep(2000);

      // Launch WhatsApp
      await this.appiumClient.launchWhatsApp();
      await this.sleep(3000);

      // Start registration flow
      await this.startRegistration();

      // Connect to backend WebSocket
      this.wsClient.connect();
      this.registerCommandHandlers();

      // Start monitoring
      this.startMessagePolling();

      logger.info('Agent started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start agent');
      throw error;
    }
  }

  private async startRegistration(): Promise<void> {
    logger.info('Starting WhatsApp registration');

    try {
      // Check if already activated
      if (await this.appiumClient.isActivated()) {
        logger.info('WhatsApp already activated');
        this.isSetupComplete = true;
        return;
      }

      // Enter phone number
      await this.appiumClient.enterPhoneNumber(config.phoneNumber);
      await this.sleep(1000);

      // Tap Next to request OTP
      await this.appiumClient.tapNext();
      
      // Confirm number
      await this.sleep(2000);
      await this.appiumClient.tapNext();

      logger.info('OTP requested, waiting for injection command');

      // Send status to backend
      this.wsClient.sendStatus({
        state: 'waiting_otp',
        phone: config.phoneNumber,
      });
    } catch (error) {
      logger.error({ error }, 'Registration flow failed');
      throw error;
    }
  }

  private registerCommandHandlers(): void {
    // Handle OTP injection
    this.wsClient.registerCommandHandler('inject_otp', async (command) => {
      logger.info({ otp: command.otp }, 'Handling inject_otp command');
      
      await this.appiumClient.injectOtp(command.otp);
      await this.sleep(5000);

      // Complete profile setup
      await this.appiumClient.completeProfileSetup();
      await this.sleep(3000);

      // Check if activated
      const activated = await this.appiumClient.isActivated();
      if (activated) {
        this.isSetupComplete = true;
        this.wsClient.sendStatus({
          state: 'activated',
          phone: config.phoneNumber,
        });
        logger.info('WhatsApp activated successfully');
      }

      return { success: activated };
    });

    // Handle send message
    this.wsClient.registerCommandHandler('send_message', async (command) => {
      logger.info({ to: command.to, messageId: command.messageId }, 'Handling send_message command');
      
      await this.appiumClient.sendMessage(command.to, command.text);
      
      return { success: true, messageId: command.messageId };
    });

    // Handle link to web
    this.wsClient.registerCommandHandler('link_to_web', async (command) => {
      logger.info('Handling link_to_web command');
      
      if (!config.linkToWeb) {
        return { success: false, error: 'Link to web not enabled' };
      }

      // Navigate to WhatsApp Web linking screen
      // This requires navigating through settings to "Linked Devices"
      // Simplified implementation - expand based on actual UI flow
      
      // Take screenshot of QR code
      await this.sleep(2000);
      const screenshot = await this.appiumClient.takeScreenshot();
      
      // Extract QR code using OCR
      const qrData = await this.ocrService.extractQrCode(screenshot);
      
      if (qrData) {
        logger.info('QR code extracted successfully');
        // In production, you'd send this to a Playwright container to scan
        return { 
          success: true, 
          qrData,
          webSessionId: `web_${Date.now()}`,
        };
      }

      return { success: false, error: 'Could not extract QR code' };
    });

    // Handle snapshot
    this.wsClient.registerCommandHandler('snapshot', async (command) => {
      logger.info('Handling snapshot command');
      // Snapshot is handled by Docker service on backend
      return { success: true };
    });

    // Handle restart
    this.wsClient.registerCommandHandler('restart', async (command) => {
      logger.info('Handling restart command');
      await this.appiumClient.launchWhatsApp();
      return { success: true };
    });
  }

  private startMessagePolling(): void {
    // Poll for new messages every 10 seconds
    this.messagePollingInterval = setInterval(async () => {
      if (!this.isSetupComplete) {
        return;
      }

      try {
        const messages = await this.appiumClient.getRecentMessages();
        
        for (const message of messages) {
          this.wsClient.sendMessageReceived(message);
        }
      } catch (error) {
        logger.error({ error }, 'Message polling failed');
      }
    }, 10000);
  }

  async stop(): Promise<void> {
    logger.info('Stopping agent');

    if (this.messagePollingInterval) {
      clearInterval(this.messagePollingInterval);
    }

    this.wsClient.disconnect();
    await this.appiumClient.disconnect();

    logger.info('Agent stopped');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Start agent
const agent = new WhatsAppAgent();

agent.start().catch((error) => {
  logger.error({ error }, 'Agent crashed');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await agent.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await agent.stop();
  process.exit(0);
});






