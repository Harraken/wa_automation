/**
 * VNC Click Utility
 * 
 * This module provides a way to click on the emulator via VNC/noVNC,
 * which bypasses WhatsApp's anti-automation detection.
 * 
 * When clicking via VNC, the events appear as genuine user input
 * rather than programmatic input from ADB/Appium.
 */

import puppeteer, { Browser } from 'puppeteer';
import Docker from 'dockerode';
import * as net from 'net';
import { findNextButton, findOkButton, findAgreeButton } from './buttonDetector';

// Initialize Docker client
let docker: Docker;
try {
  docker = new Docker({ socketPath: '/var/run/docker.sock' });
} catch {
  try {
    docker = new Docker({ socketPath: '//./pipe/docker_engine' });
  } catch {
    docker = new Docker();
  }
}

// VNC canvas dimensions vs Android screen dimensions
// noVNC canvas is typically 1080x1920 or scaled
const ANDROID_WIDTH = 1080;
const ANDROID_HEIGHT = 1920;

interface ClickResult {
  success: boolean;
  error?: string;
  method?: string;
}

/**
 * Get the noVNC URL for a container
 * Uses host.docker.internal when running in Docker, localhost otherwise
 */
function getVncUrl(vncPort: number): string {
  // When running in Docker, use host.docker.internal to access host ports
  const host = process.env.DOCKER_HOST || 'host.docker.internal';
  return `http://${host}:${vncPort}/vnc.html?autoconnect=true&resize=scale`;
}

/**
 * Click at specific coordinates via VNC using Puppeteer
 * Uses noVNC's internal RFB API for reliable coordinate handling
 * 
 * @param vncPort - The noVNC port (typically 6080)
 * @param x - X coordinate on Android screen (0-1080)
 * @param y - Y coordinate on Android screen (0-1920)
 * @param log - Logging function
 */
export async function clickViaVnc(
  vncPort: number,
  x: number,
  y: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  let browser: Browser | null = null;
  
  try {
    log(`🖱️ VNC Click: Opening noVNC on port ${vncPort}...`);
    
    // Launch Puppeteer with specific settings for noVNC
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    
    const page = await browser.newPage();
    // Use a viewport large enough to show the full Android screen without scaling
    await page.setViewport({ width: 1920, height: 1080 });
    
    const vncUrl = getVncUrl(vncPort);
    log(`🌐 VNC URL: ${vncUrl}`);
    
    // Navigate to noVNC
    await page.goto(vncUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    log(`📺 noVNC page loaded, waiting for canvas...`);
    
    // Wait for the VNC canvas to be ready
    await page.waitForSelector('canvas', { timeout: 15000 });
    
    // Wait for RFB connection to be established (poll until connected or timeout)
    log(`⏳ Waiting for VNC connection to establish...`);
    let rfbConnected = false;
    const maxWaitTime = 15000; // 15 seconds max
    const pollInterval = 500;
    const startTime = Date.now();
    
    while (!rfbConnected && (Date.now() - startTime) < maxWaitTime) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rfbConnected = await page.evaluate((): boolean => {
        const win = globalThis as any;
        const rfb = win.rfb || win.UI?.rfb;
        return rfb && (rfb._rfbConnectionState === 'connected' || rfb._rfb_connection_state === 'connected');
      });
      
      if (!rfbConnected) {
        await page.waitForTimeout(pollInterval);
      }
    }
    
    if (rfbConnected) {
      log(`✅ VNC RFB connection established after ${Date.now() - startTime}ms`);
    } else {
      log(`⚠️ VNC RFB connection not established after ${maxWaitTime}ms, proceeding anyway...`);
    }
    
    // Get canvas info and check for RFB object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vncInfo = await page.evaluate((): any => {
      const doc = (globalThis as any).document;
      const win = globalThis as any;
      const canvas = doc.querySelector('canvas');
      if (!canvas) return { error: 'Canvas not found' };
      
      const rect = canvas.getBoundingClientRect();
      
      // Check for noVNC's RFB object
      const rfb = win.rfb || win.UI?.rfb;
      const hasRfb = !!rfb;
      const rfbConnected = hasRfb && (rfb._rfbConnectionState === 'connected' || rfb._rfb_connection_state === 'connected');
      const rfbState = rfb?._rfbConnectionState || rfb?._rfb_connection_state || 'unknown';
      
      return {
        canvas: {
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          actualWidth: canvas.width,
          actualHeight: canvas.height
        },
        hasRfb,
        rfbConnected,
        rfbState,
        windowKeys: Object.keys(win).filter((k: string) => k.toLowerCase().includes('rfb') || k.toLowerCase().includes('vnc')),
      };
    });
    
    if (vncInfo.error) {
      throw new Error(vncInfo.error);
    }
    
    log(`📐 Canvas: ${vncInfo.canvas.width}x${vncInfo.canvas.height} (internal: ${vncInfo.canvas.actualWidth}x${vncInfo.canvas.actualHeight})`);
    log(`🔌 RFB available: ${vncInfo.hasRfb}, connected: ${vncInfo.rfbConnected}, state: ${vncInfo.rfbState}`);
    
    const vncWidth = vncInfo.canvas.actualWidth;
    const vncHeight = vncInfo.canvas.actualHeight;
    
    // The Android screen (portrait 1080x1920) is displayed INSIDE the VNC framebuffer (landscape 1600x900)
    // with aspect ratio maintained, meaning there are black bars on the sides
    
    // Calculate how the Android screen fits in the VNC framebuffer
    const androidRatio = ANDROID_WIDTH / ANDROID_HEIGHT; // 0.5625 (portrait)
    const vncRatio = vncWidth / vncHeight; // 1.778 (landscape)
    
    let androidDisplayWidth: number;
    let androidDisplayHeight: number;
    let offsetX: number;
    let offsetY: number;
    
    if (androidRatio < vncRatio) {
      // Android is narrower (portrait) - use full VNC height, center horizontally
      androidDisplayHeight = vncHeight;
      androidDisplayWidth = vncHeight * androidRatio;
      offsetX = (vncWidth - androidDisplayWidth) / 2;
      offsetY = 0;
    } else {
      // Android is wider - use full VNC width, center vertically  
      androidDisplayWidth = vncWidth;
      androidDisplayHeight = vncWidth / androidRatio;
      offsetX = 0;
      offsetY = (vncHeight - androidDisplayHeight) / 2;
    }
    
    // Scale factor from Android to VNC display area
    const scaleAndroid = androidDisplayHeight / ANDROID_HEIGHT;
    
    // Map Android coordinates to VNC framebuffer coordinates
    const vncX = Math.round(offsetX + (x * scaleAndroid));
    const vncY = Math.round(offsetY + (y * scaleAndroid));
    
    log(`📱 Android display in VNC: ${androidDisplayWidth.toFixed(0)}x${androidDisplayHeight.toFixed(0)} at offset (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
    log(`🎯 Android (${x}, ${y}) → VNC (${vncX}, ${vncY}) [scale: ${scaleAndroid.toFixed(4)}]`);
    
    // Now map VNC framebuffer coordinates to canvas display coordinates
    const scaleToDisplay = vncInfo.canvas.width / vncWidth;
    const displayX = vncInfo.canvas.left + (vncX * scaleToDisplay);
    const displayY = vncInfo.canvas.top + (vncY * scaleToDisplay);
    
    log(`🖱️ Display click at: (${displayX.toFixed(0)}, ${displayY.toFixed(0)}) [display scale: ${scaleToDisplay.toFixed(3)}]`);
    
    // Method 1: Use noVNC's RFB API if available (most reliable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rfbResult = await page.evaluate((vncClickX: number, vncClickY: number) => {
      const win = globalThis as any;
      const rfb = win.rfb || win.UI?.rfb;
      
      if (rfb && typeof rfb._mouseButtonMask !== 'undefined') {
        try {
          // Direct RFB protocol: send mouse event at VNC coordinates
          // mouseButton(x, y, buttonMask) - buttonMask: 1=left, 2=middle, 4=right
          if (typeof rfb.sendPointerEvent === 'function') {
            rfb.sendPointerEvent(vncClickX, vncClickY, 1); // Mouse down
            win.setTimeout(() => {
              rfb.sendPointerEvent(vncClickX, vncClickY, 0); // Mouse up
            }, 100);
            return { success: true, method: 'sendPointerEvent' };
          }
          
          // Alternative: _mouse method
          if (typeof rfb._mouse === 'function') {
            rfb._mouse(vncClickX, vncClickY, 1);
            win.setTimeout(() => {
              rfb._mouse(vncClickX, vncClickY, 0);
            }, 100);
            return { success: true, method: '_mouse' };
          }
          
          return { success: false, error: 'RFB object found but no pointer method' };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
      return { success: false, error: 'RFB not available' };
    }, vncX, vncY);
    
    if (rfbResult.success) {
      log(`✅ VNC RFB click sent via ${rfbResult.method} at VNC (${vncX}, ${vncY})`);
    } else {
      log(`⚠️ RFB method failed: ${rfbResult.error}, falling back to mouse simulation`);
    }
    
    // Method 2: Direct Puppeteer click at scaled display coordinates
    await page.mouse.move(displayX, displayY);
    await page.waitForTimeout(100);
    await page.mouse.click(displayX, displayY);
    log(`✅ Puppeteer click sent at display (${displayX.toFixed(0)}, ${displayY.toFixed(0)})`);
    
    // Method 3: Simulate touch event (some VNC clients respond better to touch)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate((clickX: number, clickY: number) => {
      const doc = (globalThis as any).document;
      const canvas = doc.querySelector('canvas');
      if (!canvas) return;
      
      const TouchClass = (globalThis as any).Touch;
      const TouchEventClass = (globalThis as any).TouchEvent;
      
      if (TouchClass && TouchEventClass) {
        try {
          const touch = new TouchClass({
            identifier: Date.now(),
            target: canvas,
            clientX: clickX,
            clientY: clickY,
            radiusX: 2.5,
            radiusY: 2.5,
            rotationAngle: 0,
            force: 1
          });
          
          canvas.dispatchEvent(new TouchEventClass('touchstart', {
            bubbles: true,
            cancelable: true,
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch]
          }));
          
          (globalThis as any).setTimeout(() => {
            canvas.dispatchEvent(new TouchEventClass('touchend', {
              bubbles: true,
              cancelable: true,
              touches: [],
              targetTouches: [],
              changedTouches: [touch]
            }));
          }, 100);
        } catch (e) {
          // Touch not supported in this context
        }
      }
    }, displayX, displayY);
    log(`✅ Touch event dispatched`);
    
    // Small delay to let the click register
    await page.waitForTimeout(500);
    
    await browser.close();
    browser = null;
    
    return { success: true, method: 'vnc-multi-method' };
    
  } catch (error: any) {
    log(`❌ VNC click failed: ${error.message}`);
    
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Click the "Next" button via VNC
 * Uses the captured coordinates from manual VNC click
 */
export async function clickNextButtonViaVnc(
  vncPort: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  // Coordinates captured from manual VNC click:
  // [2:13:21 AM] ✅ Clic manuel capturé! Coordonnées: (540, 1656)
  const NEXT_BUTTON_X = 540;
  const NEXT_BUTTON_Y = 1656;
  
  log(`🖱️ Clicking NEXT button via VNC at (${NEXT_BUTTON_X}, ${NEXT_BUTTON_Y})...`);
  return await clickViaVnc(vncPort, NEXT_BUTTON_X, NEXT_BUTTON_Y, log);
}

/**
 * Click the "Agree and Continue" button via VNC
 * This button is typically in the lower portion of the screen
 */
export async function clickAgreeButtonViaVnc(
  vncPort: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  // Agree button is typically at the bottom center
  // Approximate coordinates based on standard WhatsApp layout
  const AGREE_BUTTON_X = 540;  // Center of screen
  const AGREE_BUTTON_Y = 1750; // Near bottom
  
  log(`🖱️ Clicking AGREE button via VNC at (${AGREE_BUTTON_X}, ${AGREE_BUTTON_Y})...`);
  return await clickViaVnc(vncPort, AGREE_BUTTON_X, AGREE_BUTTON_Y, log);
}

/**
 * Click "OK" confirmation button via VNC
 */
export async function clickOkButtonViaVnc(
  vncPort: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  // OK button in confirmation dialogs - typically right side of dialog
  const OK_BUTTON_X = 700;
  const OK_BUTTON_Y = 1100;
  
  log(`🖱️ Clicking OK button via VNC at (${OK_BUTTON_X}, ${OK_BUTTON_Y})...`);
  return await clickViaVnc(vncPort, OK_BUTTON_X, OK_BUTTON_Y, log);
}

/**
 * Smart VNC Click: Detects button position via OCR then clicks via VNC
 * This is the most reliable method as it:
 * 1. Uses OCR to find the exact button position
 * 2. Uses VNC to click (bypasses anti-bot detection)
 */
export async function smartClickNextViaVnc(
  vncPort: number,
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<ClickResult> {
  log(`🧠 Smart VNC Click: Detecting NEXT button position via OCR...`);
  
  try {
    // Step 1: Detect button position using OCR
    const detection = await findNextButton(screenshotBase64, log);
    
    if (detection.found && detection.button) {
      const { x, y, text } = detection.button;
      log(`✅ OCR detected "${text}" button at (${x}, ${y})`);
      
      // Step 2: Click via VNC at detected coordinates
      return await clickViaVnc(vncPort, x, y, log);
    }
    
    // Fallback: Use default coordinates if OCR fails
    log(`⚠️ OCR detection failed, using default NEXT button coordinates...`);
    return await clickNextButtonViaVnc(vncPort, log);
    
  } catch (error: any) {
    log(`❌ Smart VNC click error: ${error.message}`);
    
    // Fallback to default coordinates
    log(`🔄 Fallback: Using default NEXT button coordinates...`);
    return await clickNextButtonViaVnc(vncPort, log);
  }
}

/**
 * Smart VNC Click for OK button
 */
export async function smartClickOkViaVnc(
  vncPort: number,
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<ClickResult> {
  log(`🧠 Smart VNC Click: Detecting OK button position via OCR...`);
  
  try {
    const detection = await findOkButton(screenshotBase64, log);
    
    if (detection.found && detection.button) {
      const { x, y, text } = detection.button;
      log(`✅ OCR detected "${text}" button at (${x}, ${y})`);
      return await clickViaVnc(vncPort, x, y, log);
    }
    
    log(`⚠️ OK button not found, using default coordinates...`);
    return await clickOkButtonViaVnc(vncPort, log);
    
  } catch (error: any) {
    log(`❌ Smart OK click error: ${error.message}`);
    return await clickOkButtonViaVnc(vncPort, log);
  }
}

/**
 * Smart VNC Click for AGREE button
 */
export async function smartClickAgreeViaVnc(
  vncPort: number,
  screenshotBase64: string,
  log: (msg: string) => void
): Promise<ClickResult> {
  log(`🧠 Smart VNC Click: Detecting AGREE button position via OCR...`);
  
  try {
    const detection = await findAgreeButton(screenshotBase64, log);
    
    if (detection.found && detection.button) {
      const { x, y, text } = detection.button;
      log(`✅ OCR detected "${text}" button at (${x}, ${y})`);
      return await clickViaVnc(vncPort, x, y, log);
    }
    
    log(`⚠️ AGREE button not found, using default coordinates...`);
    return await clickAgreeButtonViaVnc(vncPort, log);
    
  } catch (error: any) {
    log(`❌ Smart AGREE click error: ${error.message}`);
    return await clickAgreeButtonViaVnc(vncPort, log);
  }
}

/**
 * Click at coordinates via ADB using sendevent (lowest level, hardest to detect)
 * This simulates actual touch hardware events
 */
export async function clickViaAdb(
  containerId: string,
  x: number,
  y: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  try {
    log(`🖱️ ADB Click: Sending sendevent commands to container ${containerId.substring(0, 12)}...`);
    
    const container = docker.getContainer(containerId);
    
    // Use sendevent for lowest-level touch simulation
    // This is harder for apps to detect as anti-automation
    // First try to find the touchscreen device
    const findDeviceCmd = `adb -e shell "getevent -pl 2>/dev/null | grep -B5 'ABS_MT_POSITION' | grep 'add device' | head -1 | awk '{print \\$3}' | tr -d ':'"`;
    
    const findExec = await container.exec({
      Cmd: ['sh', '-c', findDeviceCmd],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const findStream = await findExec.start({ Detach: false, Tty: false });
    let devicePath = '';
    await new Promise<void>((resolve) => {
      findStream.on('data', (chunk: Buffer) => {
        devicePath += chunk.toString().trim();
      });
      findStream.on('end', () => resolve());
      setTimeout(() => resolve(), 5000);
    });
    
    // Default to common touchscreen device if not found
    if (!devicePath || devicePath.length < 5) {
      devicePath = '/dev/input/event1';
    }
    log(`📱 Touch device: ${devicePath}`);
    
    // Use input tap first (simpler), then sendevent as backup
    // Try multiple methods
    const methods = [
      // Method 1: Standard input tap
      `adb -e shell input tap ${x} ${y}`,
      // Method 2: Input touchscreen tap (different driver)
      `adb -e shell input touchscreen tap ${x} ${y}`,
      // Method 3: Input swipe with same start/end (simulates tap)
      `adb -e shell input swipe ${x} ${y} ${x} ${y} 50`,
    ];
    
    for (let i = 0; i < methods.length; i++) {
      const cmd = methods[i];
      log(`📱 Method ${i + 1}: ${cmd}`);
      
      const exec = await container.exec({
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const stream = await exec.start({ Detach: false, Tty: false });
      
      let output = '';
      await new Promise<void>((resolve) => {
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        stream.on('end', () => resolve());
        setTimeout(() => resolve(), 3000);
      });
      
      if (output.trim()) {
        log(`📋 Output: ${output.trim()}`);
      }
      
      // Small delay between methods
      await new Promise(r => setTimeout(r, 300));
    }
    
    // Method 4: Try xdotool with CORRECT VNC/X11 coordinates
    // The emulator displays Android (1080x1920 portrait) in X11 (1600x900 landscape)
    // We need to convert Android coords to X11 coords
    try {
      log(`📱 Method 4: xdotool (X11/VNC level click)`);
      
      // First, get the actual X11 screen resolution from xdotool
      const getResExec = await container.exec({
        Cmd: ['sh', '-c', 'export DISPLAY=:0 && xdotool getdisplaygeometry 2>/dev/null || echo "1600 900"'],
        AttachStdout: true,
        AttachStderr: true,
      });
      const getResStream = await getResExec.start({ Detach: false, Tty: false });
      let resOutput = '';
      await new Promise<void>((resolve) => {
        getResStream.on('data', (chunk: Buffer) => { resOutput += chunk.toString(); });
        getResStream.on('end', () => resolve());
        setTimeout(() => resolve(), 2000);
      });
      
      const resParts = resOutput.trim().split(' ');
      const X11_WIDTH = parseInt(resParts[0]) || 1600;
      const X11_HEIGHT = parseInt(resParts[1]) || 900;
      log(`📐 X11 display resolution: ${X11_WIDTH}x${X11_HEIGHT}`);
      
      // Android is displayed with aspect ratio maintained in X11
      const androidRatio = ANDROID_WIDTH / ANDROID_HEIGHT; // 0.5625
      const x11Ratio = X11_WIDTH / X11_HEIGHT;
      
      let androidDisplayWidth: number;
      let androidDisplayHeight: number;
      let offsetX: number;
      let offsetY: number;
      
      if (androidRatio < x11Ratio) {
        // Android is narrower (portrait) - use full height, center horizontally
        androidDisplayHeight = X11_HEIGHT;
        androidDisplayWidth = X11_HEIGHT * androidRatio;
        offsetX = (X11_WIDTH - androidDisplayWidth) / 2;
        offsetY = 0;
      } else {
        androidDisplayWidth = X11_WIDTH;
        androidDisplayHeight = X11_WIDTH / androidRatio;
        offsetX = 0;
        offsetY = (X11_HEIGHT - androidDisplayHeight) / 2;
      }
      
      const scaleAndroid = androidDisplayHeight / ANDROID_HEIGHT;
      const x11X = Math.round(offsetX + (x * scaleAndroid));
      const x11Y = Math.round(offsetY + (y * scaleAndroid));
      
      log(`📐 X11 coords: Android (${x}, ${y}) → X11 (${x11X}, ${x11Y})`);
      
      // Use xdotool with proper mouse down/up sequence (more like real click)
      const xdoCommands = [
        `export DISPLAY=:0`,
        `xdotool mousemove --sync ${x11X} ${x11Y}`,
        `sleep 0.1`,
        `xdotool mousedown 1`,
        `sleep 0.05`,
        `xdotool mouseup 1`,
      ].join(' && ');
      
      const xdoExec = await container.exec({
        Cmd: ['sh', '-c', `${xdoCommands} 2>&1 || echo "xdotool failed"`],
        AttachStdout: true,
        AttachStderr: true,
      });
      const xdoStream = await xdoExec.start({ Detach: false, Tty: false });
      let xdoOutput = '';
      await new Promise<void>((resolve) => {
        xdoStream.on('data', (chunk: Buffer) => { xdoOutput += chunk.toString(); });
        xdoStream.on('end', () => resolve());
        setTimeout(() => resolve(), 5000);
      });
      if (xdoOutput.trim() && xdoOutput.includes('failed')) {
        log(`⚠️ xdotool output: ${xdoOutput.trim()}`);
      } else {
        log(`✅ xdotool click sent at X11 (${x11X}, ${x11Y})`);
      }
    } catch (e: any) {
      log(`⚠️ xdotool error: ${e.message}`);
    }
    
    log(`✅ All ADB tap methods executed at (${x}, ${y})`);
    
    return { success: true, method: 'adb-multi-tap' };
    
  } catch (error: any) {
    log(`❌ ADB click failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Click the "Next" button via ADB
 * Uses the captured coordinates from manual VNC click
 */
export async function clickNextButtonViaAdb(
  containerId: string,
  log: (msg: string) => void
): Promise<ClickResult> {
  // Coordinates captured from manual VNC click:
  // The "Next" button is at the bottom center of the screen
  // For 1080x1920 screen, button is around y=1656
  const NEXT_BUTTON_X = 540;
  const NEXT_BUTTON_Y = 1656;
  
  log(`🖱️ Clicking NEXT button via ADB at (${NEXT_BUTTON_X}, ${NEXT_BUTTON_Y})...`);
  return await clickViaAdb(containerId, NEXT_BUTTON_X, NEXT_BUTTON_Y, log);
}

/**
 * Click the "OK" confirmation button via ADB
 */
export async function clickOkButtonViaAdb(
  containerId: string,
  log: (msg: string) => void
): Promise<ClickResult> {
  // OK button in confirmation dialogs - typically right side of dialog
  const OK_BUTTON_X = 700;
  const OK_BUTTON_Y = 1100;
  
  log(`🖱️ Clicking OK button via ADB at (${OK_BUTTON_X}, ${OK_BUTTON_Y})...`);
  return await clickViaAdb(containerId, OK_BUTTON_X, OK_BUTTON_Y, log);
}

/**
 * Click via native VNC/RFB protocol directly
 * This connects to the raw VNC port (5900) INSIDE the Docker network
 * and sends pointer events using the RFB protocol, bypassing noVNC entirely.
 * 
 * IMPORTANT: Port 5900 is NOT exposed to the host, but since we're running
 * inside the Docker network, we can connect directly to the container's IP.
 */
export async function clickViaNativeVnc(
  containerId: string,
  x: number,
  y: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  return new Promise(async (resolve) => {
    try {
      log(`🔌 [NATIVE VNC] Connecting to container VNC via Docker network...`);
      
      // Get container info to find the internal IP
      const container = docker.getContainer(containerId);
      const containerInfo = await container.inspect();
      
      // Get the container's IP on the wa-provisioner-network
      let containerIp: string | null = null;
      const networks = containerInfo.NetworkSettings?.Networks;
      
      if (networks) {
        // Try wa-provisioner-network first, then any other network
        for (const [networkName, networkInfo] of Object.entries(networks)) {
          const netInfo = networkInfo as { IPAddress?: string };
          if (netInfo.IPAddress) {
            containerIp = netInfo.IPAddress;
            log(`📍 Found container IP: ${containerIp} (network: ${networkName})`);
            break;
          }
        }
      }
      
      // Fallback: try container name as hostname (Docker DNS)
      const containerName = containerInfo.Name?.replace(/^\//, '') || containerId.substring(0, 12);
      
      if (!containerIp) {
        log(`⚠️ No container IP found, trying container name as hostname: ${containerName}`);
        containerIp = containerName;
      }
      
      const vncHost = containerIp;
      const vncPort = 5900; // Raw VNC port inside container
      
      log(`🎯 Connecting to VNC at ${vncHost}:${vncPort}`);
      
      // Connect to VNC server
      const socket = new net.Socket();
      let timeout: NodeJS.Timeout;
      let resolved = false;
      
      const safeResolve = (result: ClickResult) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(result);
        }
      };
      
      socket.setTimeout(10000);
      
      socket.on('error', (err) => {
        log(`❌ VNC socket error: ${err.message}`);
        socket.destroy();
        safeResolve({ success: false, error: err.message });
      });
      
      socket.on('timeout', () => {
        log(`❌ VNC socket timeout`);
        socket.destroy();
        safeResolve({ success: false, error: 'Socket timeout' });
      });
      
      socket.connect(vncPort, vncHost, () => {
        log(`✅ Connected to VNC server at ${vncHost}:${vncPort}`);
      });
      
      let stage = 'init';
      let dataBuffer = Buffer.alloc(0);
      
      socket.on('data', (data) => {
        dataBuffer = Buffer.concat([dataBuffer, data]);
        
        if (stage === 'init') {
          // Server sends protocol version "RFB 003.008\n"
          if (dataBuffer.length >= 12) {
            const version = dataBuffer.slice(0, 12).toString();
            log(`📡 VNC server version: ${version.trim()}`);
            
            // Send our protocol version
            socket.write('RFB 003.008\n');
            stage = 'security';
            dataBuffer = dataBuffer.slice(12);
          }
        } else if (stage === 'security') {
          // Server sends security types
          if (dataBuffer.length >= 1) {
            const numSecurityTypes = dataBuffer[0];
            if (dataBuffer.length >= 1 + numSecurityTypes) {
              const securityTypes = Array.from(dataBuffer.slice(1, 1 + numSecurityTypes));
              log(`🔐 Security types: ${securityTypes.join(', ')}`);
              
              // Choose security type 1 (None) if available, otherwise 2 (VNC Auth)
              if (securityTypes.includes(1)) {
                socket.write(Buffer.from([1])); // None
                stage = 'security_result';
              } else {
                log(`⚠️ No 'None' security type, VNC requires password`);
                socket.destroy();
                safeResolve({ success: false, error: 'VNC requires password' });
                return;
              }
              dataBuffer = dataBuffer.slice(1 + numSecurityTypes);
            }
          }
        } else if (stage === 'security_result') {
          // Wait for security result (4 bytes, should be 0 for success)
          if (dataBuffer.length >= 4) {
            const result = dataBuffer.readUInt32BE(0);
            if (result === 0) {
              log(`✅ VNC authentication successful`);
              // Send ClientInit (shared flag = 1)
              socket.write(Buffer.from([1]));
              stage = 'server_init';
            } else {
              log(`❌ VNC authentication failed`);
              socket.destroy();
              safeResolve({ success: false, error: 'VNC auth failed' });
              return;
            }
            dataBuffer = dataBuffer.slice(4);
          }
        } else if (stage === 'server_init') {
          // Server sends ServerInit (at least 24 bytes + name)
          if (dataBuffer.length >= 24) {
            const width = dataBuffer.readUInt16BE(0);
            const height = dataBuffer.readUInt16BE(2);
            const nameLength = dataBuffer.readUInt32BE(20);
            
            if (dataBuffer.length >= 24 + nameLength) {
              const name = dataBuffer.slice(24, 24 + nameLength).toString();
              log(`📺 VNC desktop: ${width}x${height} "${name}"`);
              
              // Calculate coordinates based on actual VNC resolution
              // Android (portrait 1080x1920) displayed in VNC (landscape) with aspect ratio
              const androidRatio = ANDROID_WIDTH / ANDROID_HEIGHT; // 0.5625
              const androidDisplayHeight = height;
              const androidDisplayWidth = height * androidRatio;
              const offsetX = (width - androidDisplayWidth) / 2;
              const scale = height / ANDROID_HEIGHT;
              
              const actualVncX = Math.round(offsetX + (x * scale));
              const actualVncY = Math.round(y * scale);
              
              log(`📐 VNC resolution: ${width}x${height}`);
              log(`📐 Android display in VNC: ${androidDisplayWidth.toFixed(0)}x${androidDisplayHeight} at offset (${offsetX.toFixed(0)}, 0)`);
              log(`📐 Scale factor: ${scale.toFixed(4)}`);
              log(`📐 Android (${x}, ${y}) → VNC (${actualVncX}, ${actualVncY})`);
              
              // Now we can send pointer events!
              stage = 'ready';
              
              // MULTI-CLICK STRATEGY
              // Try clicking multiple times with small variations in case of offset issues
              // Also uses human-like timing
              
              const sendPointer = (btnMask: number, px: number, py: number) => {
                const buf = Buffer.alloc(6);
                buf[0] = 5; // PointerEvent
                buf[1] = btnMask;
                buf.writeUInt16BE(Math.max(0, Math.min(px, width - 1)), 2);
                buf.writeUInt16BE(Math.max(0, Math.min(py, height - 1)), 4);
                socket.write(buf);
              };
              
              const doClick = (clickX: number, clickY: number, label: string): Promise<void> => {
                return new Promise((resolve) => {
                  log(`🖱️ ${label}: Moving to (${clickX}, ${clickY})...`);
                  sendPointer(0, clickX, clickY);
                  
                  setTimeout(() => {
                    sendPointer(1, clickX, clickY); // Down
                    const hold = 80 + Math.floor(Math.random() * 70);
                    
                    setTimeout(() => {
                      sendPointer(0, clickX, clickY); // Up
                      log(`✅ ${label}: Click complete`);
                      resolve();
                    }, hold);
                  }, 50 + Math.floor(Math.random() * 50));
                });
              };
              
              // Click sequence: try center and then variations
              const clickSequence = async () => {
                // Click 1: Exact center
                await doClick(actualVncX, actualVncY, 'Click 1 (center)');
                await new Promise(r => setTimeout(r, 300));
                
                // Click 2: Slightly above (in case button shifted)
                const aboveY = actualVncY - 10;
                await doClick(actualVncX, aboveY, 'Click 2 (above)');
                await new Promise(r => setTimeout(r, 300));
                
                // Click 3: Slightly left of center
                const leftX = actualVncX - 15;
                await doClick(leftX, actualVncY, 'Click 3 (left)');
                await new Promise(r => setTimeout(r, 300));
                
                // Done
                log(`✅ Native VNC multi-click sequence complete!`);
                socket.destroy();
                safeResolve({ success: true, method: 'native-rfb-multiclick' });
              };
              
              clickSequence();
              
              dataBuffer = dataBuffer.slice(24 + nameLength);
            }
          }
        }
      });
      
      // Timeout after 15 seconds
      timeout = setTimeout(() => {
        log(`❌ VNC handshake timeout`);
        socket.destroy();
        safeResolve({ success: false, error: 'Handshake timeout' });
      }, 15000);
      
    } catch (error: any) {
      log(`❌ Native VNC click failed: ${error.message}`);
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * Debug function to find the actual Android emulator window position in X11
 * Also checks current mouse position and x11vnc status
 * NOTE: This function now also ensures xdotool is installed!
 */
export async function debugX11WindowPosition(
  _containerId: string,
  log: (msg: string) => void
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    log(`🔍 [DEBUG X11] Quick X11 check (skip detailed debug for speed)...`);
    
    // Skip detailed debug for now - focus on clicking
    // The clickViaXdotoolWithWindowDetection function will install xdotool
    
    return null;
  } catch (error: any) {
    log(`❌ Debug X11 failed: ${error.message}`);
    return null;
  }
}

/**
 * Click using xdotool with actual window coordinates
 * This first INSTALLS xdotool in the emulator container, then uses it to click
 */
export async function clickViaXdotoolWithWindowDetection(
  containerId: string,
  androidX: number,
  androidY: number,
  log: (msg: string) => void
): Promise<ClickResult> {
  try {
    log(`🖱️ [XDOTOOL-INSTALL] Installing xdotool in emulator container and clicking...`);
    
    const container = docker.getContainer(containerId);
    
    // Helper to execute command AS ROOT (using UID 0, not username)
    // budtmo/docker-android doesn't have 'root' in /etc/passwd but UID 0 works
    const execCmd = async (cmd: string, timeoutMs = 30000, asRoot = false): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const execOptions: any = {
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
      };
      
      // Use UID 0 for root access (works even without root in passwd)
      if (asRoot) {
        execOptions.User = '0';
      }
      
      const exec = await container.exec(execOptions);
      const stream = await exec.start({ Detach: false, Tty: false });
      let output = '';
      await new Promise<void>((resolve) => {
        stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        stream.on('end', () => resolve());
        setTimeout(() => resolve(), timeoutMs);
      });
      // Clean Docker stream output (remove binary prefixes)
      return output.replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
    };
    
    // Step 1: Install xdotool if not present
    log(`📦 [1/4] Installing xdotool in container (using UID 0)...`);
    
    // More robust check - actually try to run xdotool
    const checkResult = await execCmd('xdotool version 2>&1 | head -1');
    log(`   📋 xdotool check: ${checkResult.substring(0, 100)}`);
    
    const xdotoolExists = checkResult.includes('xdotool') && !checkResult.includes('not found');
    
    if (xdotoolExists) {
      log(`   ✅ xdotool already working: ${checkResult.substring(0, 50)}`);
    } else {
      log(`   📥 xdotool not working, installing as UID 0 (root)...`);
      
      // Single comprehensive install command as root (UID 0)
      const installCmd = `
        echo "User: $(whoami) (UID: $(id -u))";
        mkdir -p /var/lib/apt/lists/partial 2>/dev/null || true;
        apt-get update -qq 2>&1 | tail -2;
        apt-get install -y xdotool x11-utils 2>&1 | tail -5;
        echo "---VERIFY---";
        xdotool version 2>&1 | head -1
      `.trim().replace(/\n\s+/g, ' ');
      
      log(`   📦 Running apt-get install as UID 0...`);
      const installResult = await execCmd(installCmd, 180000, true); // asRoot = true
      log(`   📋 Install output: ${installResult.substring(0, 400)}`);
      
      // Verify installation (can run as normal user now)
      const verifyResult = await execCmd('xdotool version 2>&1 | head -1');
      if (verifyResult.includes('xdotool') && !verifyResult.includes('not found')) {
        log(`   ✅ xdotool installed successfully: ${verifyResult.substring(0, 50)}`);
      } else {
        log(`   ❌ xdotool installation failed. Verify output: ${verifyResult}`);
        log(`   ℹ️ Will skip xdotool method and rely on Native VNC`);
        return { success: false, error: 'xdotool installation failed' };
      }
    }
    
    // Step 2: Get display info
    log(`📺 [2/4] Getting X11 display info...`);
    const displayInfo = await execCmd('export DISPLAY=:0 && xdotool getdisplaygeometry 2>/dev/null && xdotool getmouselocation 2>/dev/null');
    log(`   ${displayInfo.replace(/\n/g, ' | ')}`);
    
    const displayParts = displayInfo.split(/\s+/).filter(p => /^\d+$/.test(p));
    const displayWidth = parseInt(displayParts[0]) || 1600;
    const displayHeight = parseInt(displayParts[1]) || 900;
    
    // Step 3: Calculate coordinates
    log(`📐 [3/4] Calculating click coordinates...`);
    const androidRatio = ANDROID_WIDTH / ANDROID_HEIGHT;
    const windowHeight = displayHeight;
    const windowWidth = Math.round(displayHeight * androidRatio);
    const windowX = Math.round((displayWidth - windowWidth) / 2);
    const windowY = 0;
    
    const scale = windowHeight / ANDROID_HEIGHT;
    const x11X = windowX + Math.round(androidX * scale);
    const x11Y = windowY + Math.round(androidY * scale);
    
    log(`   Display: ${displayWidth}x${displayHeight}`);
    log(`   Android area: (${windowX}, ${windowY}) ${windowWidth}x${windowHeight}`);
    log(`   Android (${androidX}, ${androidY}) → X11 (${x11X}, ${x11Y}) [scale: ${scale.toFixed(4)}]`);
    
    // Step 4: Find emulator window and click on it
    log(`🖱️ [4/4] Finding emulator window and clicking at (${x11X}, ${x11Y})...`);
    
    // First verify xdotool is working
    const verifyResult = await execCmd('DISPLAY=:0 xdotool version 2>&1 || echo "XDOTOOL_NOT_WORKING"');
    if (verifyResult.includes('XDOTOOL_NOT_WORKING') || verifyResult.includes('not found')) {
      log(`   ❌ xdotool verification failed: ${verifyResult}`);
      return { success: false, error: 'xdotool not working after install attempt' };
    }
    log(`   ✅ xdotool verified: ${verifyResult.split('\n')[0]}`);
    
    // Get current mouse position first - it contains the window ID!
    const beforePos = await execCmd('DISPLAY=:0 xdotool getmouselocation 2>&1');
    log(`   📍 Mouse before: ${beforePos.trim()}`);
    
    // Extract window ID from getmouselocation output (format: "window:543")
    let targetWindow = '';
    const windowMatch = beforePos.match(/window:(\d+)/);
    if (windowMatch) {
      targetWindow = windowMatch[1];
      log(`   🪟 Found window ID from mouse location: ${targetWindow}`);
    }
    
    // If not found, search for emulator window
    if (!targetWindow) {
      log(`   🔍 Searching for emulator window...`);
      const windowSearch = await execCmd(`
        export DISPLAY=:0;
        xdotool search --name "Android" 2>/dev/null | head -1 || 
        xdotool search --name "emulator" 2>/dev/null | head -1 || 
        xdotool search --class "qemu" 2>/dev/null | head -1 || 
        xdotool getactivewindow 2>/dev/null || 
        echo "NO_WINDOW"
      `.trim().replace(/\n\s+/g, ' '));
      
      log(`   📋 Window search result: ${windowSearch.trim()}`);
      
      if (windowSearch && !windowSearch.includes('NO_WINDOW') && /^\d+$/.test(windowSearch.trim())) {
        targetWindow = windowSearch.trim();
        log(`   🪟 Found window ID from search: ${targetWindow}`);
      }
    }
    
    // Get active window - if it's the Android Emulator, use it as target (don't close it!)
    const activeWindowCheck = await execCmd('DISPLAY=:0 xdotool getactivewindow 2>/dev/null || echo "none"');
    const activeWindowId = activeWindowCheck.trim();
    log(`   📋 Current active window: ${activeWindowId}`);

    const activeWindowName = activeWindowId && activeWindowId !== 'none'
      ? await execCmd(`DISPLAY=:0 xdotool getwindowname ${activeWindowId} 2>/dev/null || echo ""`)
      : '';
    const activeIsEmulator = /android|emulator|qemu/i.test(activeWindowName.trim());

    // Prefer the active window if it's the emulator (it's the one we must click on)
    if (activeWindowId && activeWindowId !== 'none' && activeIsEmulator) {
      log(`   ✅ Active window is the emulator: "${activeWindowName.trim().substring(0, 50)}" → using it as target`);
      targetWindow = activeWindowId;
    }

    if (targetWindow) {
      // Get window info
      const windowInfo = await execCmd(`DISPLAY=:0 xdotool getwindowname ${targetWindow} 2>/dev/null || echo "no_name"; xdotool getwindowgeometry ${targetWindow} 2>/dev/null || echo "no_geometry"`);
      log(`   📋 Window info: ${windowInfo.replace(/\n/g, ' | ')}`);

      // Only try to close/minimize the active window if it's NOT the emulator
      if (activeWindowId !== targetWindow && activeWindowId !== 'none' && !activeIsEmulator) {
        log(`   🔍 Active window (${activeWindowId}) is not emulator, closing/minimizing...`);
        await execCmd(`DISPLAY=:0 xdotool windowclose ${activeWindowId} 2>&1 || true`);
        await new Promise(r => setTimeout(r, 200));
        await execCmd(`DISPLAY=:0 xdotool windowminimize ${activeWindowId} 2>&1 || true`);
        await new Promise(r => setTimeout(r, 200));
      }

      // Focus the target (emulator) window once, then click
      log(`   🎯 Focusing emulator window ${targetWindow}...`);
      await execCmd(`DISPLAY=:0 xdotool windowactivate --sync ${targetWindow} 2>&1 || true`);
      await execCmd(`DISPLAY=:0 xdotool windowfocus --sync ${targetWindow} 2>&1 || true`);
      await execCmd(`DISPLAY=:0 xdotool windowraise ${targetWindow} 2>&1 || true`);
      await new Promise(r => setTimeout(r, 400));
      
      // Final verification
      const finalActive = await execCmd('DISPLAY=:0 xdotool getactivewindow 2>/dev/null || echo "none"');
      log(`   📋 Final active window: ${finalActive.trim()}`);
      
      // If still not active, we'll try clicking on both windows
      if (finalActive.trim() !== targetWindow && finalActive.trim() !== 'none') {
        log(`   ⚠️ Window ${targetWindow} is not active (${finalActive.trim()} is)`);
        log(`   🔄 Will try clicking on both windows`);
      }
    } else {
      log(`   ⚠️ No window ID found, will use screen coordinates`);
    }
    
    // Get final active window
    const finalActiveCheck = await execCmd('DISPLAY=:0 xdotool getactivewindow 2>/dev/null || echo "none"');
    let finalActiveId = finalActiveCheck.trim();
    log(`   📋 Window to use for click: target=${targetWindow || 'none'}, active=${finalActiveId}`);

    // Do NOT close the active window if it's the emulator (same app, possibly different ID)
    const finalActiveName = finalActiveId && finalActiveId !== 'none'
      ? await execCmd(`DISPLAY=:0 xdotool getwindowname ${finalActiveId} 2>/dev/null || echo ""`)
      : '';
    const finalActiveIsEmulator = /android|emulator|qemu/i.test(finalActiveName.trim());

    if (finalActiveId !== 'none' && finalActiveId !== targetWindow && targetWindow && !finalActiveIsEmulator) {
      log(`   🧹 Final cleanup: Closing non-emulator window ${finalActiveId}...`);
      await execCmd(`DISPLAY=:0 xdotool windowclose ${finalActiveId} 2>&1 || true`);
      await execCmd(`DISPLAY=:0 xdotool windowunmap ${finalActiveId} 2>&1 || true`);
      await new Promise(r => setTimeout(r, 200));
      await execCmd(`DISPLAY=:0 xdotool windowactivate --sync ${targetWindow} 2>&1 || true`);
      await execCmd(`DISPLAY=:0 xdotool windowfocus --sync ${targetWindow} 2>&1 || true`);
      await new Promise(r => setTimeout(r, 200));
      const recheckActive = await execCmd('DISPLAY=:0 xdotool getactivewindow 2>/dev/null || echo "none"');
      finalActiveId = recheckActive.trim();
      log(`   📋 After cleanup: active=${finalActiveId}, target=${targetWindow}`);
    } else if (finalActiveIsEmulator && finalActiveId !== targetWindow) {
      log(`   ℹ️ Active window is also emulator (${finalActiveId}), will click on target ${targetWindow}`);
    }
    
    // METHOD A: Click with window targeting - try both target and active window
    const windowsToTry = [];
    if (targetWindow) windowsToTry.push({ id: targetWindow, name: 'target', useAbsoluteCoords: false });
    if (finalActiveId !== 'none' && finalActiveId !== targetWindow) {
      // For active window, we need to check if coordinates are within its bounds
      // If not, we'll use absolute screen coordinates
      windowsToTry.push({ id: finalActiveId, name: 'active', useAbsoluteCoords: true });
    }
    
    for (const win of windowsToTry) {
      log(`   🖱️ METHOD A${win.name === 'active' ? '-ACTIVE' : ''}: Click via window ${win.id} at (${x11X}, ${x11Y})...`);
      
      // Get window geometry to verify coordinates are within bounds
      const geometry = await execCmd(`DISPLAY=:0 xdotool getwindowgeometry ${win.id} 2>&1`);
      log(`   📐 Window ${win.id} geometry: ${geometry.replace(/\n/g, ' | ')}`);
      
      // Extract window position and size from geometry
      const geometryMatch = geometry.match(/Position: (\d+),(\d+).*Geometry: (\d+)x(\d+)/);
      let windowX = 0, windowY = 0, windowW = 1600, windowH = 900;
      if (geometryMatch) {
        windowX = parseInt(geometryMatch[1]);
        windowY = parseInt(geometryMatch[2]);
        windowW = parseInt(geometryMatch[3]);
        windowH = parseInt(geometryMatch[4]);
        log(`   📐 Window ${win.id} bounds: x=${windowX}, y=${windowY}, w=${windowW}, h=${windowH}`);
      }
      
      // For active window, check if our target coordinates are within its bounds
      // If not, use absolute screen coordinates instead
      let clickX = x11X;
      let clickY = x11Y;
      let useWindowRelative = !win.useAbsoluteCoords;
      
      if (win.useAbsoluteCoords) {
        // Check if coordinates are within active window bounds
        const inBounds = (x11X >= windowX && x11X < windowX + windowW && 
                         x11Y >= windowY && x11Y < windowY + windowH);
        if (inBounds) {
          // Convert to window-relative coordinates
          clickX = x11X - windowX;
          clickY = x11Y - windowY;
          useWindowRelative = true;
          log(`   📐 Coordinates within active window bounds, using relative: (${clickX}, ${clickY})`);
        } else {
          log(`   📐 Coordinates outside active window bounds, using absolute screen: (${x11X}, ${x11Y})`);
          useWindowRelative = false;
        }
      }
      
      // Move mouse to position
      if (useWindowRelative) {
        log(`   🖱️ Moving mouse to window-relative position (${clickX}, ${clickY})...`);
        const moveResult = await execCmd(`DISPLAY=:0 xdotool mousemove --window ${win.id} --sync ${clickX} ${clickY} 2>&1`);
        if (moveResult.trim()) log(`   📋 Move result: ${moveResult.trim()}`);
      } else {
        log(`   🖱️ Moving mouse to absolute screen position (${clickX}, ${clickY})...`);
        const moveResult = await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${clickX} ${clickY} 2>&1`);
        if (moveResult.trim()) log(`   📋 Move result: ${moveResult.trim()}`);
      }
      
      await new Promise(r => setTimeout(r, 150));
      
      // Verify position
      const posAfterMove = await execCmd('DISPLAY=:0 xdotool getmouselocation 2>&1');
      log(`   📍 Position after move: ${posAfterMove.trim()}`);
      
      // Click on the window with explicit button down/up
      // Try multiple click methods for active window
      if (win.name === 'active') {
        log(`   🖱️ Active window click - trying multiple aggressive methods...`);
        
        // Method 1: Window-relative click
        if (useWindowRelative) {
          log(`   🖱️ Method 1: Window-relative click on ${win.id}...`);
          await execCmd(`DISPLAY=:0 xdotool mousedown --window ${win.id} 1 2>&1`);
          await new Promise(r => setTimeout(r, 100));
          await execCmd(`DISPLAY=:0 xdotool mouseup --window ${win.id} 1 2>&1`);
        }
        
        // Method 2: Absolute screen click (might pass through overlay)
        log(`   🖱️ Method 2: Absolute screen click at (${x11X}, ${x11Y})...`);
        await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${x11X} ${x11Y} 2>&1`);
        await new Promise(r => setTimeout(r, 50));
        await execCmd('DISPLAY=:0 xdotool mousedown 1 2>&1');
        await new Promise(r => setTimeout(r, 100));
        await execCmd('DISPLAY=:0 xdotool mouseup 1 2>&1');
        
        // Method 3: Long press (hold for 300ms) - sometimes needed for stubborn buttons
        log(`   🖱️ Method 3: Long press (300ms) at (${x11X}, ${x11Y})...`);
        await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${x11X} ${x11Y} 2>&1`);
        await execCmd('DISPLAY=:0 xdotool mousedown 1 2>&1');
        await new Promise(r => setTimeout(r, 300)); // Hold for 300ms
        await execCmd('DISPLAY=:0 xdotool mouseup 1 2>&1');
        await new Promise(r => setTimeout(r, 100));
        
        // Method 4: Double-click (rapid double tap)
        log(`   🖱️ Method 4: Double-click at (${x11X}, ${x11Y})...`);
        await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${x11X} ${x11Y} 2>&1`);
        await execCmd('DISPLAY=:0 xdotool click --repeat 2 --delay 50 1 2>&1');
        await new Promise(r => setTimeout(r, 100));
        
        // Method 5: Triple-click (very rapid)
        log(`   🖱️ Method 5: Triple-click at (${x11X}, ${x11Y})...`);
        await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${x11X} ${x11Y} 2>&1`);
        await execCmd('DISPLAY=:0 xdotool click --repeat 3 --delay 30 1 2>&1');
        await new Promise(r => setTimeout(r, 100));
        
        // Method 6: Multiple rapid clicks (sometimes needed for overlays)
        log(`   🖱️ Method 6: Multiple rapid clicks (5x)...`);
        for (let i = 0; i < 5; i++) {
          await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${x11X} ${x11Y} 2>&1`);
          await execCmd('DISPLAY=:0 xdotool click 1 2>&1');
          await new Promise(r => setTimeout(r, 30));
        }
      } else {
        // Standard click for target window - but also try long press and double-click
        log(`   🖱️ Clicking (button down) on window ${win.id}...`);
        await execCmd(`DISPLAY=:0 xdotool mousedown --window ${win.id} 1 2>&1`);
        await new Promise(r => setTimeout(r, 100));
        
        log(`   🖱️ Releasing (button up) on window ${win.id}...`);
        await execCmd(`DISPLAY=:0 xdotool mouseup --window ${win.id} 1 2>&1`);
        await new Promise(r => setTimeout(r, 100));
        
        // Also try long press on target window
        log(`   🖱️ Long press (200ms) on window ${win.id}...`);
        await execCmd(`DISPLAY=:0 xdotool mousedown --window ${win.id} 1 2>&1`);
        await new Promise(r => setTimeout(r, 200));
        await execCmd(`DISPLAY=:0 xdotool mouseup --window ${win.id} 1 2>&1`);
        await new Promise(r => setTimeout(r, 100));
        
        // And double-click
        log(`   🖱️ Double-click on window ${win.id}...`);
        await execCmd(`DISPLAY=:0 xdotool click --window ${win.id} --repeat 2 --delay 50 1 2>&1`);
      }
      
      const afterA = await execCmd('DISPLAY=:0 xdotool getmouselocation 2>&1');
      log(`   📍 After METHOD A (${win.name}): ${afterA.trim()}`);
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    // METHOD B: Standard screen-relative click (as backup/additional)
    // Try multiple times with slight variations AND different click types
    log(`   🖱️ METHOD B: Standard screen click at (${x11X}, ${x11Y})...`);
    
    const variations = [
      { x: x11X, y: x11Y, label: 'center' },
      { x: x11X - 5, y: x11Y, label: 'left' },
      { x: x11X + 5, y: x11Y, label: 'right' },
      { x: x11X, y: x11Y - 5, label: 'above' },
      { x: x11X, y: x11Y + 5, label: 'below' },
    ];
    
    for (const variant of variations) {
      log(`   🖱️ METHOD B-${variant.label}: Clicking at (${variant.x}, ${variant.y})...`);
      await execCmd(`DISPLAY=:0 xdotool mousemove --sync ${variant.x} ${variant.y} 2>&1`);
      await new Promise(r => setTimeout(r, 100));
      
      // Standard click
      await execCmd('DISPLAY=:0 xdotool click 1 2>&1');
      await new Promise(r => setTimeout(r, 50));
      
      // Long press (200ms)
      await execCmd('DISPLAY=:0 xdotool mousedown 1 2>&1');
      await new Promise(r => setTimeout(r, 200));
      await execCmd('DISPLAY=:0 xdotool mouseup 1 2>&1');
      await new Promise(r => setTimeout(r, 50));
      
      // Double-click
      await execCmd('DISPLAY=:0 xdotool click --repeat 2 --delay 50 1 2>&1');
      await new Promise(r => setTimeout(r, 50));
    }
    
    const afterB = await execCmd('DISPLAY=:0 xdotool getmouselocation 2>&1');
    log(`   📍 After METHOD B: ${afterB.trim()}`);
    
    await new Promise(r => setTimeout(r, 200));
    
    // METHOD C: Key event simulation (send ENTER to focused window)
    if (targetWindow) {
      log(`   ⌨️ METHOD C: Sending ENTER key to window ${targetWindow}...`);
      await execCmd(`DISPLAY=:0 xdotool key --window ${targetWindow} Return 2>&1`);
    } else {
      log(`   ⌨️ METHOD C: Sending ENTER key to active window...`);
      await execCmd('DISPLAY=:0 xdotool key Return 2>&1');
    }
    
    // Final position check
    const afterClick = await execCmd('DISPLAY=:0 xdotool getmouselocation 2>&1');
    log(`   📍 Mouse final: ${afterClick.trim()}`);
    
    log(`✅ xdotool click sequence completed at X11 (${x11X}, ${x11Y})`);
    return { success: true, method: 'xdotool-window-targeted' };
    
  } catch (error: any) {
    log(`❌ xdotool click failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
