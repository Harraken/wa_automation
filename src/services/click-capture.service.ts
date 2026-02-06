import Docker from 'dockerode';
import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';
import { sessionService } from './session.service';

const logger = createChildLogger('click-capture');

/** Broadcast message to provisioning logs and write to session log */
async function broadcastCaptureLog(sessionId: string, message: string, level: 'info' | 'warn' = 'info'): Promise<void> {
  try {
    await sessionService.createLog({ sessionId, level, message, source: 'click-capture' });
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { provisionId: true } });
    if (session?.provisionId) {
      const { agentManager } = await import('../websocket/agent.manager');
      agentManager.broadcastToFrontend('provision_update', { provisionId: session.provisionId, sessionId, message });
    }
  } catch (e: any) {
    logger.warn({ sessionId, error: e.message }, 'Failed to broadcast capture log');
  }
}

// Map to store active click capture processes
const activeCaptures = new Map<string, { process: any; containerId: string }>();

/**
 * Start capturing mouse clicks in the emulator container
 * Uses xdotool to monitor mouse clicks and save coordinates
 */
export async function startClickCapture(
  sessionId: string,
  containerId: string,
  buttonType: string = 'NEXT'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if already capturing
    if (activeCaptures.has(sessionId)) {
      logger.info({ sessionId }, 'Click capture already active');
      return { success: true };
    }

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

    const container = docker.getContainer(containerId);

    // Ensure xdotool is installed
    logger.info({ sessionId, containerId }, 'Installing xdotool if needed...');
    const installCheck = await execInContainer(container, 'xdotool version 2>&1 | head -1');
    
    if (!installCheck.includes('xdotool') || installCheck.includes('not found')) {
      logger.info({ sessionId }, 'Installing xdotool...');
      await execInContainer(container, `
        mkdir -p /var/lib/apt/lists/partial 2>/dev/null || true;
        apt-get update -qq 2>&1 | tail -2;
        apt-get install -y xdotool x11-utils 2>&1 | tail -5;
      `.trim().replace(/\n\s+/g, ' '), 180000, true);
    }

    // Start click capture script using xev (more reliable for click detection)
    // First ensure xev is installed
    logger.info({ sessionId }, 'Installing x11-utils (xev) if needed...');
    await execInContainer(container, `
      apt-get update -qq 2>&1 | tail -2;
      apt-get install -y x11-utils 2>&1 | tail -3;
    `.trim().replace(/\n\s+/g, ' '), 180000, true);

    // Simple script that uses xev to detect clicks and xdotool to get position
    const captureScript = `
      export DISPLAY=:0;
      echo "🎯 Click capture started. Click on the button to capture coordinates...";
      
      # Use xev to monitor button press events on root window
      xev -root -event button 2>/dev/null | while IFS= read -r line; do
        # Look for ButtonPress events (button 1 = left click)
        if echo "$line" | grep -q "ButtonPress.*button 1"; then
          # Get mouse position immediately after click
          sleep 0.05;
          POS=$(xdotool getmouselocation 2>/dev/null);
          if [ -n "$POS" ]; then
            # Extract X11 coordinates (format: x:800 y:450)
            X=$(echo "$POS" | sed -n 's/.*x:\\([0-9]*\\).*/\\1/p');
            Y=$(echo "$POS" | sed -n 's/.*y:\\([0-9]*\\).*/\\1/p');
            
            if [ -n "$X" ] && [ -n "$Y" ]; then
              # Convert X11 to Android coordinates
              # Android: 1080x1920, X11: 1600x900
              # Android area: offset_x=547, scale=900/1920
              OFFSET_X=547;
              ANDROID_X=$(( ($X - $OFFSET_X) * 1920 / 900 ));
              ANDROID_Y=$(( $Y * 1920 / 900 ));
              
              # Validate bounds
              if [ "$ANDROID_X" -ge 0 ] && [ "$ANDROID_X" -le 1080 ] && [ "$ANDROID_Y" -ge 0 ] && [ "$ANDROID_Y" -le 1920 ]; then
                echo "CLICK_CAPTURED:\${ANDROID_X},\${ANDROID_Y}";
              fi
            fi
          fi
        fi
      done
    `;

    // Start the capture process
    const exec = await container.exec({
      Cmd: ['sh', '-c', captureScript],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: false,
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    // Process output
    stream.on('data', async (chunk: Buffer) => {
      const output = chunk.toString();
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('CLICK_CAPTURED:')) {
          const coords = line.replace('CLICK_CAPTURED:', '').split(',');
          const x = parseInt(coords[0]);
          const y = parseInt(coords[1]);
          
          if (!isNaN(x) && !isNaN(y)) {
            logger.info({ sessionId, x, y, buttonType }, 'Click captured!');
            await broadcastCaptureLog(sessionId, `✅ Clic capturé: (${x}, ${y}) pour ${buttonType}`);
            await saveCapturedClick(buttonType, x, y, sessionId);
          }
        } else if (line.trim()) {
          logger.debug({ sessionId, output: line.trim() }, 'Capture output');
        }
      }
    });

    stream.on('end', () => {
      logger.info({ sessionId }, 'Click capture stream ended');
      activeCaptures.delete(sessionId);
    });

    // Store the capture process
    activeCaptures.set(sessionId, { process: stream, containerId });

    await broadcastCaptureLog(sessionId, `🎯 Capture clic démarrée (bouton ${buttonType}). Cliquez sur le bouton dans le stream.`);
    logger.info({ sessionId, containerId, buttonType }, 'Click capture started');
    return { success: true };

  } catch (error: any) {
    logger.error({ error: error.message, sessionId, containerId }, 'Failed to start click capture');
    return { success: false, error: error.message };
  }
}

/**
 * Stop click capture for a session
 */
export async function stopClickCapture(sessionId: string): Promise<{ success: boolean }> {
  const capture = activeCaptures.get(sessionId);
  if (capture) {
    try {
      capture.process.destroy();
      activeCaptures.delete(sessionId);
      await broadcastCaptureLog(sessionId, '🛑 Capture clic arrêtée.');
      logger.info({ sessionId }, 'Click capture stopped');
      return { success: true };
    } catch (error: any) {
      logger.error({ error: error.message, sessionId }, 'Error stopping click capture');
      return { success: false };
    }
  }
  return { success: true };
}

/**
 * Save captured click coordinates to database
 */
export async function saveCapturedClick(
  buttonType: string,
  x: number,
  y: number,
  _sessionId: string
): Promise<void> {
  try {
    // Check if we already have coordinates for this button type
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM learned_clicks WHERE button_type = ${buttonType} LIMIT 1
    `;

    if (existing.length > 0) {
      // Update existing
      await prisma.$executeRaw`
        UPDATE learned_clicks 
        SET x = ${x}, y = ${y}, success_count = success_count + 1, last_used = NOW(), updated_at = NOW()
        WHERE button_type = ${buttonType}
      `;
      logger.info({ buttonType, x, y }, 'Updated learned click coordinates');
    } else {
      // Create new
      await prisma.$executeRaw`
        INSERT INTO learned_clicks (id, button_type, x, y, success_count, last_used, created_at, updated_at)
        VALUES (gen_random_uuid()::text, ${buttonType}, ${x}, ${y}, 1, NOW(), NOW(), NOW())
      `;
      logger.info({ buttonType, x, y }, 'Saved new learned click coordinates');
    }
  } catch (error: any) {
    logger.error({ error: error.message, buttonType, x, y }, 'Failed to save captured click');
  }
}

/**
 * Get learned click coordinates for a button type
 */
export async function getLearnedClick(buttonType: string): Promise<{ x: number; y: number } | null> {
  try {
    const result = await prisma.$queryRaw<Array<{ x: number; y: number }>>`
      SELECT x, y FROM learned_clicks WHERE button_type = ${buttonType} LIMIT 1
    `;

    if (result.length > 0) {
      return { x: result[0].x, y: result[0].y };
    }
    return null;
  } catch (error: any) {
    logger.error({ error: error.message, buttonType }, 'Failed to get learned click');
    return null;
  }
}

/**
 * Helper to execute command in container
 */
async function execInContainer(
  container: Docker.Container,
  cmd: string,
  timeoutMs = 30000,
  asRoot = false
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execOptions: any = {
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
  };

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
  
  return output.replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
}
