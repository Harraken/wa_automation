import { provisionService } from '../src/services/provision.service';

async function createNewProvision() {
  try {
    console.log('📞 Creating new provision to purchase a new phone number...\n');
    
    // Create provision (empty country_id = auto-detect available country)
    const provision = await provisionService.createProvision({
      countryId: '', // Empty = auto-detect available country
      applicationId: '', // Auto-detect WhatsApp
      linkToWeb: false,
    });

    console.log(`✅ Provision created:`);
    console.log(`   Provision ID: ${provision.id}`);
    console.log(`   State: ${provision.state}`);
    
    // Enqueue provisioning job
    const { provisionQueue } = await import('../src/services/queue.service');
    const job = await provisionQueue.add('onboard-provision', {
      provisionId: provision.id,
      countryId: '', // Empty = auto-detect
      applicationId: '',
      linkToWeb: false,
    });

    console.log(`\n✅ Job enqueued:`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Status: ${job.name}`);
    
    console.log(`\n🚀 Provisioning process started!`);
    console.log(`   The system will:`);
    console.log(`   1. Auto-detect an available country`);
    console.log(`   2. Purchase a new phone number`);
    console.log(`   3. Create an Android emulator`);
    console.log(`   4. Automate WhatsApp registration`);
    console.log(`\n💡 Check the frontend or logs to monitor progress.`);
    
  } catch (error: any) {
    console.error(`\n❌ Error creating provision:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  } finally {
    // Don't disconnect here - queue service might need the connection
    // await prisma.$disconnect();
  }
}

createNewProvision()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

