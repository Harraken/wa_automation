import Docker from 'dockerode';
import axios from 'axios';
import { createChildLogger } from '../utils/logger';
import { config } from '../config';

const logger = createChildLogger('docker-service');

export interface SpawnEmulatorOptions {
  sessionId: string;
  phone: string;
  agentToken: string;
  linkToWeb?: boolean;
}

export interface EmulatorInfo {
  containerId: string;
  streamUrl: string;
  vncPort: number;
  appiumPort: number;
}

// Initialize Docker client
// Connect to Docker socket - in container, use /var/run/docker.sock
// For local development, try both locations
let docker: Docker;
try {
  // Try Docker socket (standard location)
  docker = new Docker({ socketPath: '/var/run/docker.sock' });
} catch (error) {
  // Fallback for Windows or other setups
  try {
    docker = new Docker({ socketPath: '//./pipe/docker_engine' });
  } catch (error2) {
    logger.warn('Failed to connect to Docker socket, will use default');
    docker = new Docker();
  }
}

export class DockerService {
  private portCounter = 0;

  /**
   * Get next available port
   */
  private async getNextPort(basePort: number): Promise<number> {
    // Get all containers with our label to find used ports
    const containers = await docker.listContainers({ 
      all: true,
      filters: { label: ['whatsapp-provisioner=true'] }
    });

    // Extract used ports from running containers
    const usedPortsSet = new Set<number>();
    containers.forEach(container => {
      if (container.Ports) {
        container.Ports.forEach(portInfo => {
          if (portInfo.PublicPort) {
            usedPortsSet.add(portInfo.PublicPort);
          }
        });
      }
    });

    // Also check ports from database (sessions)
    try {
      const { prisma } = await import('../utils/db');
      const sessions = await prisma.session.findMany({
        where: { isActive: true },
        select: { vncPort: true, appiumPort: true },
      });

      sessions.forEach(session => {
        if (session.vncPort) usedPortsSet.add(session.vncPort);
        if (session.appiumPort) usedPortsSet.add(session.appiumPort);
      });
    } catch (e) {
      // If DB query fails, continue with container ports only
    }

    // Find next available port
    let port = basePort;
    let attempts = 0;
    
    while (usedPortsSet.has(port) && attempts < 1000) {
      this.portCounter++;
      port = basePort + this.portCounter;
      attempts++;
    }

    if (attempts >= 1000) {
      throw new Error(`Unable to find available port starting from ${basePort}`);
    }

    logger.debug({ port, basePort }, 'Allocated port');
    return port;
  }

  /**
   * Install and start agent in running container
   */
  private async installAgentInContainer(containerId: string, _options: SpawnEmulatorOptions): Promise<void> {
    logger.info({ containerId }, 'Checking agent installation in container');
    
    // For now, just log that the container is ready
    // The agent installation can be done manually or via a custom Docker image
    logger.info({ containerId }, 'Container is ready. Agent can be installed manually if needed.');
    logger.warn({ containerId }, 'Note: Manual WhatsApp setup may be required in the emulator');
  }

  /**
   * Ensure Docker image exists, pull if needed
   */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      // Check if image exists locally
      const images = await docker.listImages();
      const imageExists = images.some((img: any) => 
        img.RepoTags && img.RepoTags.includes(imageName) ||
        img.RepoTags && img.RepoTags.includes(`${imageName}:latest`)
      );

      if (!imageExists) {
        logger.info({ imageName }, 'Image not found locally, pulling...');
        
        // Pull the image
        await new Promise<void>((resolve, reject) => {
          docker.pull(imageName, {}, (err: any, stream: any) => {
            if (err) {
              reject(err);
              return;
            }

            docker.modem.followProgress(stream, (err: any) => {
              if (err) {
                reject(err);
              } else {
                logger.info({ imageName }, 'Image pulled successfully');
                resolve();
              }
            });
          });
        });
      } else {
        logger.info({ imageName }, 'Image already exists locally');
      }
    } catch (error: any) {
      logger.error({ error: error.message, imageName }, 'Failed to ensure image exists');
      throw new Error(`Failed to pull Docker image: ${error.message}`);
    }
  }

  /**
   * Spawn a new Android emulator container
   */
  async spawnEmulator(options: SpawnEmulatorOptions): Promise<EmulatorInfo> {
    const { sessionId, phone, agentToken, linkToWeb = false } = options;
    
    logger.info({ sessionId, phone, linkToWeb }, 'Spawning emulator container');

    try {
      // Ensure image exists before creating container
      await this.ensureImage(config.emulator.image);

      // Get ports - all dynamic to avoid conflicts
      const vncPort = await this.getNextPort(config.emulator.baseVncPort); // noVNC web (6080)
      const appiumPort = await this.getNextPort(config.emulator.baseAppiumPort);
      const adbPort = await this.getNextPort(config.emulator.baseAdbPort);
      // Note: We don't expose raw VNC (5900) to avoid port conflicts
      // noVNC (6080) is sufficient for web access

      // Create container name
      const containerName = `wa-emulator-${sessionId}`;

      // Check if container with this name already exists and remove it
      try {
        const existingContainer = docker.getContainer(containerName);
        const inspect = await existingContainer.inspect().catch(() => null);
        if (inspect) {
          logger.warn({ containerName, containerId: inspect.Id }, 'Container already exists, removing it');
          try {
            // Try to stop the container
            if (inspect.State.Running) {
              await existingContainer.stop({ t: 10 });
              logger.info({ containerName }, 'Stopped existing container');
            }
          } catch (e: any) {
            logger.warn({ containerName, error: e.message }, 'Failed to stop container (may already be stopped)');
          }
          
          // Force remove the container
          try {
            await existingContainer.remove({ force: true });
            logger.info({ containerName }, 'Removed existing container');
            // Wait a bit for Docker to fully release the name
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e: any) {
            logger.error({ containerName, error: e.message }, 'Failed to remove container');
            throw new Error(`Failed to remove existing container ${containerName}: ${e.message}`);
          }
        }
      } catch (e: any) {
        // If it's not a "not found" error, throw it
        if (!e.message || !e.message.includes('no such container')) {
          logger.warn({ containerName, error: e.message }, 'Error checking for existing container');
        }
      }

      logger.info({ 
        containerName,
        image: config.emulator.image,
        vncPort,
        appiumPort,
        adbPort
      }, 'Creating container');

      // Container configuration
      const container = await docker.createContainer({
        Image: config.emulator.image,
        name: containerName,
        AttachStdout: true,
        AttachStderr: true,
        Env: [
          `DEVICE_N=${adbPort}`,
          `PHONE_NUMBER=${phone}`,
          `AGENT_TOKEN=${agentToken}`,
          `PROVISION_ID=${sessionId}`,
          `API_URL=http://wa-api:3000`,
          `LINK_TO_WEB=${linkToWeb ? 'true' : 'false'}`,
        ],
        ExposedPorts: {
          '6080/tcp': {}, // noVNC web
          '5554/tcp': {}, // ADB
          '5555/tcp': {}, // ADB
          '4723/tcp': {}, // Appium
        },
        HostConfig: {
          PortBindings: {
            '6080/tcp': [{ HostPort: vncPort.toString() }],
            '4723/tcp': [{ HostPort: appiumPort.toString() }],
            '5555/tcp': [{ HostPort: adbPort.toString() }],
          },
          Privileged: true, // Required for Android emulator
          AutoRemove: false, // Keep container for inspection
          NetworkMode: 'wa-provisioner-network', // Connect to same network as worker
        },
        Labels: {
          'whatsapp-provisioner': 'true',
          'session-id': sessionId,
          'phone': phone,
        },
      });

      logger.info({ containerId: container.id }, 'Container created, starting...');

      // Start container
      await container.start();

      const streamUrl = `http://localhost:${vncPort}/vnc.html?resize=scale&autoconnect=1`;
      
      logger.info({ 
        containerId: container.id, 
        containerName,
        vncPort, 
        appiumPort,
        adbPort,
        streamUrl 
      }, 'Emulator container started');

      // Wait for VNC to be ready (check if port is accessible)
      logger.info({ vncPort }, 'Waiting for noVNC web interface to be ready...');
      await this.waitForVnc(vncPort, 60000);

      // Wait for container to initialize (Android emulator needs more time to boot)
      logger.info({ containerId: container.id }, 'Waiting for container to initialize (20s)...');
      await new Promise(resolve => setTimeout(resolve, 20000)); // Increased to 20s

      // Try to install and start Appium in the container if it's not running
      try {
        await this.ensureAppiumRunning(container.id, appiumPort);
      } catch (error: any) {
        logger.warn({ error: error.message, containerId: container.id }, 'Failed to start Appium, automation may fail');
      }

      // Try to install and start agent in the container
      try {
        await this.installAgentInContainer(container.id, options);
      } catch (error: any) {
        logger.warn({ error: error.message, containerId: container.id }, 'Failed to install agent, container will run without agent');
      }

      return {
        containerId: containerName, // Use container name instead of hash for DNS resolution
        streamUrl,
        vncPort,
        appiumPort,
      };
    } catch (error: any) {
      logger.error({ error: error.message, sessionId, phone }, 'Failed to spawn emulator');
      throw new Error(`Failed to spawn emulator: ${error.message}`);
    }
  }

  /**
   * Stop and remove an emulator container
   */
  async stopEmulator(containerId: string): Promise<void> {
    logger.info({ containerId }, 'Stopping emulator container');
    
    try {
      const container = docker.getContainer(containerId);
      
      try {
        await container.stop({ t: 10 }); // 10 second timeout
      } catch (error: any) {
        if (!error.statusCode || error.statusCode !== 304) { // 304 = already stopped
          logger.warn({ error: error.message }, 'Error stopping container, will try to remove');
        }
      }
      
      try {
        await container.remove({ force: true });
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Error removing container');
      }
      
      logger.info({ containerId }, 'Emulator container stopped and removed');
    } catch (error: any) {
      logger.error({ error: error.message, containerId }, 'Failed to stop emulator');
      throw error;
    }
  }

  /**
   * Get container status
   */
  async getContainerStatus(containerId: string): Promise<'running' | 'stopped' | 'not_found'> {
    try {
      const container = docker.getContainer(containerId);
      const inspect = await container.inspect();
      
      if (inspect.State.Running) {
        return 'running';
      } else {
        return 'stopped';
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        return 'not_found';
      }
      throw error;
    }
  }

  /**
   * Snapshot a container
   */
  async snapshotContainer(containerId: string, snapshotPath: string): Promise<void> {
    logger.info({ containerId, snapshotPath }, 'Creating container snapshot');
    
    try {
      const container = docker.getContainer(containerId);
      
      // Get container commit
      const image = await container.commit({
        repo: 'wa-provisioner',
        tag: `snapshot-${containerId.substring(0, 12)}`,
      });
      
      logger.info({ containerId, snapshotPath, image: image.Id }, 'Container snapshot created');
      
      // TODO: Save snapshot to file system if needed
      // This would require docker save/load or volume management
    } catch (error: any) {
      logger.error({ error: error.message, containerId }, 'Failed to create snapshot');
      throw error;
    }
  }

  /**
   * Wait for VNC to be ready
   */
  private async waitForVnc(port: number, timeout: number = 60000): Promise<void> {
    const startTime = Date.now();
    const maxAttempts = Math.floor(timeout / 3000);
    let attempt = 0;

    while (Date.now() - startTime < timeout) {
      attempt++;
      try {
        // Try to access the noVNC HTML page
        const response = await axios.get(`http://localhost:${port}/vnc.html`, {
          timeout: 2000,
          validateStatus: (status) => status < 500 // Accept any non-5xx status
        });
        
        if (response.status < 400) {
          logger.info({ port, attempt, elapsed: Date.now() - startTime }, 'VNC is ready');
          return;
        }
      } catch (error: any) {
        if (attempt % 5 === 0) {
          logger.debug({ port, attempt, maxAttempts, error: error.message }, 'VNC not ready yet, retrying...');
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Don't throw error - VNC might still work later
    logger.warn({ port, timeout }, 'VNC did not become ready within timeout, but continuing anyway');
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string): Promise<void> {
    return this.stopEmulator(containerId);
  }

  /**
   * Ensure Appium is running in the container
   */
  private async ensureAppiumRunning(containerId: string, appiumPort: number): Promise<void> {
    logger.info({ containerId, appiumPort }, 'Ensuring Appium is running');
    
    try {
      const container = docker.getContainer(containerId);
      
      // Wait for container to be fully ready (Android emulator needs time to boot)
      logger.info({ containerId }, 'Waiting for container to be ready (20s)...');
      await new Promise(resolve => setTimeout(resolve, 20000));
      
      // In budtmo/docker-android image, Appium is NOT started by supervisord automatically
      // We need to start it manually
      logger.info({ containerId }, 'Starting Appium manually (budtmo image does not auto-start it)...');
      
      // Kill any existing Appium processes first (in case supervisord tried and failed)
      try {
        const killExec = await container.exec({
          Cmd: ['sh', '-c', 'pkill -9 -f appium || true'],
          AttachStdout: true,
          AttachStderr: true,
        });
        await killExec.start({ Detach: false, Tty: false });
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`🧹 [APPIUM] Cleaned up any existing processes`);
      } catch (killError) {
        // Ignore errors
      }
      
      // Start Appium in background with nohup
      // Enable relaxed-security to allow adb_shell commands (required for WhatsApp installation)
      logger.info({ containerId }, 'Starting Appium server with relaxed-security...');
      const startExec = await container.exec({
        Cmd: ['sh', '-c', 'nohup appium --address 0.0.0.0 --port 4723 --relaxed-security > /tmp/appium.log 2>&1 &'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const startStream = await startExec.start({ Detach: false, Tty: false });
      let startOutput = '';
      startStream.on('data', (chunk: Buffer) => {
        startOutput += chunk.toString();
      });
      await new Promise(resolve => startStream.on('end', resolve));
      
      console.log(`🚀 [APPIUM] Start command executed`);
      
      // Wait for Appium to initialize (it takes time to load drivers)
      logger.info({ containerId }, 'Waiting for Appium to initialize (30s)...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Now verify it's running using HTTP (most reliable method)
      // Since we're in a Docker container, we need to access the host's mapped port
      // Try both host.docker.internal (Docker Desktop) and the container's network IP
      let isAppiumReady = false;
      const maxAttempts = 20; // 20 attempts = 100 seconds total
      
      // Get container info to find its IP on the Docker network
      const containerInfo = await container.inspect();
      const containerIP = containerInfo.NetworkSettings?.Networks?.['wa-provisioner-network']?.IPAddress;
      const containerName = containerInfo.Name.replace(/^\//, ''); // Remove leading /
      
      console.log(`🔍 [APPIUM] Container IP: ${containerIP}, Container name: ${containerName}`);
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Try multiple methods to connect
        const urls = [
          `http://${containerIP}:4723/status`, // Direct container IP
          `http://${containerName}:4723/status`, // Container name (might work)
          `http://host.docker.internal:${appiumPort}/status`, // Docker Desktop host
          `http://localhost:${appiumPort}/status`, // Fallback
        ];
        
        let lastError: any = null;
        for (const url of urls) {
          try {
            const response = await axios.get(url, { timeout: 3000 });
            if (response.status === 200 && response.data?.value?.ready) {
              isAppiumReady = true;
              console.log(`✅ [APPIUM] Appium is ready via ${url}! (attempt ${attempt}/${maxAttempts})`);
              break;
            }
          } catch (error: any) {
            lastError = error;
            // Try next URL
          }
        }
        
        if (isAppiumReady) {
          break;
        }
        
        if (attempt % 5 === 0) {
          console.log(`⏳ [APPIUM] Waiting for Appium HTTP server... (attempt ${attempt}/${maxAttempts}, last error: ${lastError?.message || 'none'})`);
        }
        
        if (!isAppiumReady && attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      if (!isAppiumReady) {
        // Check logs for errors
        try {
          const logExec = await container.exec({
            Cmd: ['sh', '-c', 'tail -50 /tmp/appium.log 2>/dev/null || echo "No logs"'],
            AttachStdout: true,
            AttachStderr: true,
          });
          const logStream = await logExec.start({ Detach: false, Tty: false });
          let logOutput = '';
          logStream.on('data', (chunk: Buffer) => {
            logOutput += chunk.toString();
          });
          await new Promise(resolve => logStream.on('end', resolve));
          console.log(`📋 [APPIUM] Recent logs: ${logOutput.substring(0, 500)}`);
        } catch (e) {
          // Ignore
        }
        
        throw new Error(`Appium failed to start after ${maxAttempts * 5} seconds`);
      }
      
      console.log(`✅ [APPIUM] Appium confirmed running and ready on port ${appiumPort}`);
      
      // Appium is now running and ready
      return;
    } catch (error: any) {
      logger.error({ error: error.message, containerId }, 'Could not ensure Appium is running');
      console.log(`❌ [APPIUM] Error: ${error.message}`);
      console.log(`❌ [APPIUM] Stack: ${error.stack}`);
      // Don't throw, just log - the automation service will handle the timeout
    }
  }

  /**
   * List all running emulator containers
   */
  async listEmulators(): Promise<any[]> {
    try {
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: ['whatsapp-provisioner=true'],
        },
      });
      return containers;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list emulators');
      return [];
    }
  }
}

export const dockerService = new DockerService();
