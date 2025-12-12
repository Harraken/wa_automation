import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { logger } from './logger';

export class OCRService {
  /**
   * Extract QR code from screenshot
   * This is a simplified version - in production, use a proper QR decoder
   */
  async extractQrCode(imageBuffer: Buffer): Promise<string | null> {
    logger.info('Extracting QR code from screenshot');

    try {
      // Preprocess image for better OCR
      const processedImage = await sharp(imageBuffer)
        .greyscale()
        .normalize()
        .toBuffer();

      // Use Tesseract to extract text
      // Note: For actual QR code reading, use a library like 'qrcode-reader' or 'jsqr'
      const { data: { text } } = await Tesseract.recognize(processedImage, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug({ progress: m.progress }, 'OCR progress');
          }
        },
      });

      logger.info({ extractedText: text }, 'OCR completed');

      // For WhatsApp Web QR, we're looking for a long alphanumeric string
      // This is simplified - use proper QR decoder in production
      const qrMatch = text.match(/[A-Za-z0-9+/=]{100,}/);
      if (qrMatch) {
        return qrMatch[0];
      }

      return null;
    } catch (error) {
      logger.error({ error }, 'OCR extraction failed');
      return null;
    }
  }

  /**
   * Detect if QR code is present in image
   */
  async hasQrCode(imageBuffer: Buffer): Promise<boolean> {
    try {
      // Simple check: convert to grayscale and check for high contrast patterns
      const { width, height } = await sharp(imageBuffer).metadata();
      
      if (!width || !height) {
        return false;
      }

      // If image has roughly square aspect ratio in center, might be QR
      // This is very basic - use proper QR detection in production
      return true; // Placeholder
    } catch (error) {
      return false;
    }
  }
}






