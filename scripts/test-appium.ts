import Docker from 'dockerode';
import axios from 'axios';

const docker = new Docker();

async function testAppium() {
  console.log('🧪 Testing Appium startup in Docker container...\n');

  const containerName = 'wa-test-appium';
  
  // Clean up any existing test container
  try {
    const existing = docker.getContainer(containerName);
    await existing.stop();
    await existing.remove({ force: true });
    console.log('✅ Cleaned up existing test container\n');
  } catch (e) {
    // Container doesn't exist, that's fine
  }

  try {
    // Find available ports
    let appiumPort = 4723;
    let vncPort = 5900;
    let adbPort = 5555;
    
    // Check if ports are available
    const containers = await docker.listContainers({ all: true });
    const usedPorts = new Set<number>();
    
    for (const container of containers) {
      for (const port of container.Ports || []) {
        if (port.PublicPort) {
          usedPorts.add(port.PublicPort);
        }
      }
    }
    
    // Find available ports
    while (usedPorts.has(appiumPort)) appiumPort++;
    while (usedPorts.has(vncPort)) vncPort++;
    while (usedPorts.has(adbPort)) adbPort++;
    
    console.log(`📡 Using ports: Appium=${appiumPort}, VNC=${vncPort}, ADB=${adbPort}\n`);

    console.log('🚀 Creating container...');
    const container = await docker.createContainer({
      Image: 'budtmo/docker-android:latest',
      name: containerName,
      HostConfig: {
        PortBindings: {
          '4723/tcp': [{ HostPort: appiumPort.toString() }],
          '5900/tcp': [{ HostPort: vncPort.toString() }],
          '5555/tcp': [{ HostPort: adbPort.toString() }],
        },
        NetworkMode: 'wa-provisioner-network',
        Privileged: true,
      },
      Labels: {
        'whatsapp-provisioner': 'true',
      },
    });

    console.log('▶️ Starting container...');
    await container.start();
    console.log(`✅ Container started: ${container.id.substring(0, 12)}\n`);

    // Stream logs in real-time
    console.log('📋 Streaming container logs in real-time...\n');
    const containerLogStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 0,
    });

    // Read logs in the background
    let logBuffer = '';
    containerLogStream.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      logBuffer += text;
      // Print important lines
      if (text.includes('appium') || text.includes('Appium') || text.includes('supervisor') || text.includes('FATAL') || text.includes('error')) {
        process.stdout.write(`[LOG] ${text}`);
      }
    });

    // Wait for container to initialize with progressive checks
    console.log('⏳ Waiting for container initialization (checking every 5s)...\n');
    let waited = 0;
    const maxWait = 60; // Maximum 60 seconds
    
    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      waited += 5;
      
      // Quick check if Appium is already up
      try {
        const quickCheck = await container.exec({
          Cmd: ['sh', '-c', 'pgrep -f appium && echo "running" || echo "not_running"'],
          AttachStdout: true,
          AttachStderr: true,
        });
        const quickStream = await quickCheck.start({ Detach: false, Tty: false });
        let quickOutput = '';
        quickStream.on('data', (chunk: Buffer) => {
          quickOutput += chunk.toString();
        });
        await new Promise(resolve => quickStream.on('end', resolve));
        
        if (quickOutput.includes('running')) {
          console.log(`\n✅ Appium process detected after ${waited}s!`);
          break;
        }
      } catch (e) {
        // Ignore
      }
      
      // Try HTTP connection early
      if (waited >= 10) {
        try {
          const response = await axios.get(`http://localhost:${appiumPort}/status`, { timeout: 2000 });
          if (response.status === 200) {
            console.log(`\n✅ Appium HTTP ready after ${waited}s!`);
            break;
          }
        } catch (e) {
          // Not ready yet
        }
      }
      
      process.stdout.write(`⏳ ${waited}s... `);
    }
    
    console.log(`\n\n`);

    // Check supervisor status
    console.log('\n📋 Checking supervisor services...');
    const supervisorExec = await container.exec({
      Cmd: ['sh', '-c', 'supervisorctl status 2>&1 || echo "supervisorctl not available"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const supervisorStream = await supervisorExec.start({ Detach: false, Tty: false });
    let supervisorOutput = '';
    supervisorStream.on('data', (chunk: Buffer) => {
      supervisorOutput += chunk.toString();
    });
    await new Promise(resolve => supervisorStream.on('end', resolve));
    
    console.log('Supervisor status:');
    console.log(supervisorOutput);
    console.log('');

    // Check if Appium process is running
    console.log('🔍 Checking Appium process...');
    const processExec = await container.exec({
      Cmd: ['sh', '-c', 'ps aux | grep appium | grep -v grep || echo "No Appium process found"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const processStream = await processExec.start({ Detach: false, Tty: false });
    let processOutput = '';
    processStream.on('data', (chunk: Buffer) => {
      processOutput += chunk.toString();
    });
    await new Promise(resolve => processStream.on('end', resolve));
    
    console.log('Appium process:');
    console.log(processOutput || 'No output');
    console.log('');

    // Check if port 4723 is listening
    console.log('🔍 Checking if port 4723 is listening...');
    const portExec = await container.exec({
      Cmd: ['sh', '-c', 'netstat -tlnp 2>/dev/null | grep 4723 || ss -tlnp 2>/dev/null | grep 4723 || echo "Port 4723 not listening"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const portStream = await portExec.start({ Detach: false, Tty: false });
    let portOutput = '';
    portStream.on('data', (chunk: Buffer) => {
      portOutput += chunk.toString();
    });
    await new Promise(resolve => portStream.on('end', resolve));
    
    console.log('Port status:');
    console.log(portOutput || 'No output');
    console.log('');

    // Check Appium logs
    console.log('📋 Checking Appium logs...');
    const logExec = await container.exec({
      Cmd: ['sh', '-c', 'cat /var/log/supervisor/appium*.log 2>/dev/null | tail -50 || echo "No Appium logs found"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const logStream = await logExec.start({ Detach: false, Tty: false });
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString();
    });
    await new Promise(resolve => logStream.on('end', resolve));
    
    console.log('Appium logs:');
    console.log(logOutput || 'No logs found');
    console.log('');

    // Try to start Appium manually
    console.log('🔧 Attempting to start Appium manually...');
    const startExec = await container.exec({
      Cmd: ['sh', '-c', 'which appium && appium --version'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const startStream = await startExec.start({ Detach: false, Tty: false });
    let startOutput = '';
    startStream.on('data', (chunk: Buffer) => {
      startOutput += chunk.toString();
    });
    await new Promise(resolve => startStream.on('end', resolve));
    
    console.log('Appium location and version:');
    console.log(startOutput || 'Appium not found');
    console.log('');

    // Try to start Appium
    console.log('🚀 Starting Appium in background...');
    const bgStartExec = await container.exec({
      Cmd: ['sh', '-c', 'nohup appium --address 0.0.0.0 --port 4723 > /tmp/appium-test.log 2>&1 &'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    await bgStartExec.start({ Detach: false, Tty: false });
    
    console.log('⏳ Waiting 10 seconds for Appium to start...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check if Appium is now running
    console.log('\n🔍 Re-checking Appium process and port...');
    const recheckProcessExec = await container.exec({
      Cmd: ['sh', '-c', 'ps aux | grep appium | grep -v grep || echo "Still no Appium process"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const recheckProcessStream = await recheckProcessExec.start({ Detach: false, Tty: false });
    let recheckProcessOutput = '';
    recheckProcessStream.on('data', (chunk: Buffer) => {
      recheckProcessOutput += chunk.toString();
    });
    await new Promise(resolve => recheckProcessStream.on('end', resolve));
    
    console.log('Appium process after manual start:');
    console.log(recheckProcessOutput || 'No output');
    console.log('');

    // Check port again
    const recheckPortExec = await container.exec({
      Cmd: ['sh', '-c', 'netstat -tlnp 2>/dev/null | grep 4723 || ss -tlnp 2>/dev/null | grep 4723 || echo "Port 4723 still not listening"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const recheckPortStream = await recheckPortExec.start({ Detach: false, Tty: false });
    let recheckPortOutput = '';
    recheckPortStream.on('data', (chunk: Buffer) => {
      recheckPortOutput += chunk.toString();
    });
    await new Promise(resolve => recheckPortStream.on('end', resolve));
    
    console.log('Port status after manual start:');
    console.log(recheckPortOutput || 'No output');
    console.log('');

    // Check manual start logs
    console.log('📋 Checking manual start logs...');
    const manualLogExec = await container.exec({
      Cmd: ['sh', '-c', 'cat /tmp/appium-test.log 2>/dev/null || echo "No manual start logs"'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const manualLogStream = await manualLogExec.start({ Detach: false, Tty: false });
    let manualLogOutput = '';
    manualLogStream.on('data', (chunk: Buffer) => {
      manualLogOutput += chunk.toString();
    });
    await new Promise(resolve => manualLogStream.on('end', resolve));
    
    console.log('Manual start logs:');
    console.log(manualLogOutput || 'No logs found');
    console.log('');

    // Try to connect to Appium via HTTP with retries
    console.log(`🌐 Testing HTTP connection to Appium on localhost:${appiumPort}...`);
    let httpSuccess = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const response = await axios.get(`http://localhost:${appiumPort}/status`, { timeout: 5000 });
        console.log(`✅ Appium HTTP status: ${response.status}`);
        console.log(`✅ Response:`, JSON.stringify(response.data, null, 2));
        httpSuccess = true;
        break;
      } catch (error: any) {
        console.log(`⏳ Attempt ${attempt}/6: ${error.message}...`);
        if (attempt < 6) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    if (!httpSuccess) {
      console.log(`\n❌ Appium HTTP connection failed after all attempts`);
      console.log(`\n📋 Recent container logs:`);
      console.log(logBuffer.split('\n').slice(-30).join('\n'));
    }

    console.log('\n📊 Summary:');
    console.log(`- Container ID: ${container.id.substring(0, 12)}`);
    console.log(`- Appium Port: ${appiumPort}`);
    console.log(`- VNC Port: ${vncPort}`);
    console.log(`- Container running: ${(await container.inspect()).State.Running}`);
    
    console.log('\n💡 To keep container for further testing:');
    console.log(`   docker exec -it ${containerName} sh`);
    console.log(`\n💡 To clean up: docker stop ${containerName} && docker rm ${containerName}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testAppium().catch(console.error);

