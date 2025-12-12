#!/usr/bin/env ts-node

/**
 * Cleanup Orphan Sessions Script
 * 
 * This script removes sessions from the database that no longer have
 * active Docker containers. Useful for cleaning up after container crashes
 * or manual container deletions.
 */

import { PrismaClient } from '@prisma/client';
import Docker from 'dockerode';

const prisma = new PrismaClient();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function main() {
  console.log('🔍 Checking for orphan sessions...\n');

  try {
    // Get all sessions from database
    const sessions = await prisma.session.findMany({
      include: {
        provision: true,
      },
    });

    console.log(`Found ${sessions.length} sessions in database\n`);

    // Get all running containers
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ['whatsapp-provisioner=true'],
      },
    });

    const containerIds = new Set(containers.map((c) => c.Id));
    const containerNames = new Set(
      containers.flatMap((c) => c.Names.map((name) => name.replace(/^\//, '')))
    );

    let orphanCount = 0;
    const orphanSessions: string[] = [];

    // Check each session
    for (const session of sessions) {
      const emulatorExists = containerIds.has(session.containerId);
      const websockifyName = `websockify-${session.id}`;
      const websockifyExists = containerNames.has(websockifyName);

      if (!emulatorExists && !websockifyExists) {
        orphanCount++;
        orphanSessions.push(session.id);
        console.log(`❌ Orphan session found:`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}`);
        console.log(`   Container ID: ${session.containerId}`);
        console.log(`   Created: ${session.createdAt}`);
        console.log(`   Status: No containers found\n`);
      } else if (!emulatorExists) {
        console.log(`⚠️  Partial orphan (emulator missing):`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}\n`);
      } else if (!websockifyExists) {
        console.log(`⚠️  Partial orphan (websockify missing):`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}\n`);
      } else {
        console.log(`✅ Session ${session.id} has active containers`);
      }
    }

    if (orphanCount === 0) {
      console.log('\n✨ No orphan sessions found! All sessions have active containers.\n');
      return;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total sessions: ${sessions.length}`);
    console.log(`   Orphan sessions: ${orphanCount}\n`);

    // Ask for confirmation before cleanup
    console.log('Do you want to mark these sessions as inactive? (yes/no)');
    
    // For automated scripts, you can uncomment this to auto-confirm:
    // const answer = 'yes';
    
    // For manual confirmation (requires user input):
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      readline.question('', (ans: string) => {
        readline.close();
        resolve(ans.toLowerCase());
      });
    });

    if (answer === 'yes' || answer === 'y') {
      // Mark sessions as inactive
      const result = await prisma.session.updateMany({
        where: {
          id: {
            in: orphanSessions,
          },
        },
        data: {
          isActive: false,
        },
      });

      console.log(`\n✅ Marked ${result.count} sessions as inactive\n`);
    } else {
      console.log('\n❌ Cleanup cancelled\n');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();



/**
 * Cleanup Orphan Sessions Script
 * 
 * This script removes sessions from the database that no longer have
 * active Docker containers. Useful for cleaning up after container crashes
 * or manual container deletions.
 */

import { PrismaClient } from '@prisma/client';
import Docker from 'dockerode';

const prisma = new PrismaClient();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function main() {
  console.log('🔍 Checking for orphan sessions...\n');

  try {
    // Get all sessions from database
    const sessions = await prisma.session.findMany({
      include: {
        provision: true,
      },
    });

    console.log(`Found ${sessions.length} sessions in database\n`);

    // Get all running containers
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ['whatsapp-provisioner=true'],
      },
    });

    const containerIds = new Set(containers.map((c) => c.Id));
    const containerNames = new Set(
      containers.flatMap((c) => c.Names.map((name) => name.replace(/^\//, '')))
    );

    let orphanCount = 0;
    const orphanSessions: string[] = [];

    // Check each session
    for (const session of sessions) {
      const emulatorExists = containerIds.has(session.containerId);
      const websockifyName = `websockify-${session.id}`;
      const websockifyExists = containerNames.has(websockifyName);

      if (!emulatorExists && !websockifyExists) {
        orphanCount++;
        orphanSessions.push(session.id);
        console.log(`❌ Orphan session found:`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}`);
        console.log(`   Container ID: ${session.containerId}`);
        console.log(`   Created: ${session.createdAt}`);
        console.log(`   Status: No containers found\n`);
      } else if (!emulatorExists) {
        console.log(`⚠️  Partial orphan (emulator missing):`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}\n`);
      } else if (!websockifyExists) {
        console.log(`⚠️  Partial orphan (websockify missing):`);
        console.log(`   Session ID: ${session.id}`);
        console.log(`   Phone: ${session.provision?.phone || 'N/A'}\n`);
      } else {
        console.log(`✅ Session ${session.id} has active containers`);
      }
    }

    if (orphanCount === 0) {
      console.log('\n✨ No orphan sessions found! All sessions have active containers.\n');
      return;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total sessions: ${sessions.length}`);
    console.log(`   Orphan sessions: ${orphanCount}\n`);

    // Ask for confirmation before cleanup
    console.log('Do you want to mark these sessions as inactive? (yes/no)');
    
    // For automated scripts, you can uncomment this to auto-confirm:
    // const answer = 'yes';
    
    // For manual confirmation (requires user input):
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      readline.question('', (ans: string) => {
        readline.close();
        resolve(ans.toLowerCase());
      });
    });

    if (answer === 'yes' || answer === 'y') {
      // Mark sessions as inactive
      const result = await prisma.session.updateMany({
        where: {
          id: {
            in: orphanSessions,
          },
        },
        data: {
          isActive: false,
        },
      });

      console.log(`\n✅ Marked ${result.count} sessions as inactive\n`);
    } else {
      console.log('\n❌ Cleanup cancelled\n');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

















