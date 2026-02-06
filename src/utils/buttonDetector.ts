/**
 * Button Detector Service
 * 
 * Uses OCR (Tesseract.js) to detect buttons on screenshots
 * and return their coordinates for VNC clicking.
 */

import Tesseract from 'tesseract.js';
import sharp from 'sharp';

interface ButtonPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface DetectionResult {
  found: boolean;
  button?: ButtonPosition;
  allButtons?: ButtonPosition[];
  error?: string;
}

/**
 * Detect buttons in a screenshot using OCR
 * Returns coordinates of detected text/buttons
 */
export async function detectButtonsInScreenshot(
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<ButtonPosition[]> {
  try {
    log(`🔍 OCR: Analyzing screenshot for buttons...`);
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(screenshotBase64, 'base64');
    
    // Get image dimensions for coordinate mapping
    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width || 1080;
    const imageHeight = metadata.height || 1920;
    
    log(`📐 Image dimensions: ${imageWidth}x${imageHeight}`);
    
    // Preprocess image for better OCR
    const processedImage = await sharp(imageBuffer)
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();
    
    // Run OCR with word-level bounding boxes
    const result = await Tesseract.recognize(processedImage, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && m.progress === 1) {
          log(`✅ OCR: Text recognition complete`);
        }
      },
    });
    
    const buttons: ButtonPosition[] = [];
    
    // Extract words with their positions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ocrData = result.data as any;
    
    if (ocrData.words && Array.isArray(ocrData.words)) {
      for (const word of ocrData.words) {
        const text = (word.text || '').trim().toUpperCase();
        
        // Filter for button-like text
        if (text.length >= 2 && word.confidence > 50) {
          const bbox = word.bbox || { x0: 0, x1: 0, y0: 0, y1: 0 };
          
          // Calculate center coordinates
          const centerX = Math.round(bbox.x0 + (bbox.x1 - bbox.x0) / 2);
          const centerY = Math.round(bbox.y0 + (bbox.y1 - bbox.y0) / 2);
          
          buttons.push({
            text: text,
            x: centerX,
            y: centerY,
            width: bbox.x1 - bbox.x0,
            height: bbox.y1 - bbox.y0,
            confidence: word.confidence,
          });
        }
      }
    }
    
    log(`📊 OCR: Found ${buttons.length} text elements`);
    
    // Log detected buttons for debugging
    buttons.forEach((btn, i) => {
      log(`  ${i + 1}. "${btn.text}" at (${btn.x}, ${btn.y}) - confidence: ${btn.confidence.toFixed(1)}%`);
    });
    
    return buttons;
    
  } catch (error: any) {
    log(`❌ OCR error: ${error.message}`);
    return [];
  }
}

/**
 * Find a specific button by text (e.g., "NEXT", "OK", "AGREE")
 */
export async function findButtonByText(
  screenshotBase64: string,
  buttonText: string,
  log: (msg: string) => void
): Promise<DetectionResult> {
  try {
    const searchText = buttonText.toUpperCase();
    log(`🎯 Searching for button: "${searchText}"`);
    
    const buttons = await detectButtonsInScreenshot(screenshotBase64, log);
    
    // Find exact match first
    let foundButton = buttons.find(b => b.text === searchText);
    
    // If no exact match, try partial match
    if (!foundButton) {
      foundButton = buttons.find(b => b.text.includes(searchText) || searchText.includes(b.text));
    }
    
    if (foundButton) {
      log(`✅ Found "${buttonText}" button at (${foundButton.x}, ${foundButton.y})`);
      return {
        found: true,
        button: foundButton,
        allButtons: buttons,
      };
    }
    
    log(`⚠️ Button "${buttonText}" not found in screenshot`);
    return {
      found: false,
      allButtons: buttons,
    };
    
  } catch (error: any) {
    log(`❌ Button detection error: ${error.message}`);
    return {
      found: false,
      error: error.message,
    };
  }
}

/**
 * Find the "NEXT" button specifically
 * Also checks for variations like "SUIVANT", ">", arrow icons
 */
export async function findNextButton(
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<DetectionResult> {
  const variations = ['NEXT', 'SUIVANT', 'CONTINUER', 'CONTINUE', '→', '>'];
  
  for (const text of variations) {
    const result = await findButtonByText(screenshotBase64, text, log);
    if (result.found) {
      return result;
    }
  }
  
  // If not found by text, look for a button in the typical "Next" position
  // (bottom right area of the screen, y > 1500 for 1920 height screens)
  log(`⚠️ No NEXT text found, looking for button in typical position...`);
  
  const buttons = await detectButtonsInScreenshot(screenshotBase64, log);
  
  // Filter buttons in the lower portion of the screen (y > 1400)
  const bottomButtons = buttons.filter(b => b.y > 1400);
  
  if (bottomButtons.length > 0) {
    // Take the rightmost button in the bottom area
    const rightmostButton = bottomButtons.reduce((prev, curr) => 
      curr.x > prev.x ? curr : prev
    );
    
    log(`🎯 Found button "${rightmostButton.text}" at bottom-right (${rightmostButton.x}, ${rightmostButton.y})`);
    return {
      found: true,
      button: rightmostButton,
      allButtons: buttons,
    };
  }
  
  return {
    found: false,
    allButtons: buttons,
  };
}

/**
 * Find the "OK" confirmation button
 */
export async function findOkButton(
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<DetectionResult> {
  const variations = ['OK', 'CONFIRM', 'YES', 'OUI', 'CONFIRMER'];
  
  for (const text of variations) {
    const result = await findButtonByText(screenshotBase64, text, log);
    if (result.found) {
      return result;
    }
  }
  
  return { found: false };
}

/**
 * Find the "AGREE" button
 */
export async function findAgreeButton(
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<DetectionResult> {
  const variations = ['AGREE', 'ACCEPT', "J'ACCEPTE", 'ACCEPTER', 'AGREE AND CONTINUE'];
  
  for (const text of variations) {
    const result = await findButtonByText(screenshotBase64, text, log);
    if (result.found) {
      return result;
    }
  }
  
  return { found: false };
}
