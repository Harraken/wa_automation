import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanAll() {
  try {
    console.log('🧹 Starting cleanup of all sessions and provisions...');
    
    // Delete all sessions
    const deletedSessions = await prisma.session.deleteMany({});
    console.log(`✅ Deleted ${deletedSessions.count} sessions`);
    
    // Delete all OTP logs
    const deletedOtps = await prisma.otpLog.deleteMany({});
    console.log(`✅ Deleted ${deletedOtps.count} OTP logs`);
    
    // Delete all messages
    const deletedMessages = await prisma.message.deleteMany({});
    console.log(`✅ Deleted ${deletedMessages.count} messages`);
    
    // Delete all provisions
    const deletedProvisions = await prisma.provision.deleteMany({});
    console.log(`✅ Deleted ${deletedProvisions.count} provisions`);
    
    console.log('✨ Cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanAll();


