import { prisma } from '../src/utils/db';

async function deleteAllPhoneNumbers() {
  try {
    console.log('🗑️  Deleting all phone numbers from database...');
    
    const result = await prisma.phoneNumber.deleteMany({});
    
    console.log(`✅ Successfully deleted ${result.count} phone number(s)`);
    console.log('✅ Next provision will purchase a new number');
  } catch (error: any) {
    console.error('❌ Error deleting phone numbers:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

deleteAllPhoneNumbers()
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });

