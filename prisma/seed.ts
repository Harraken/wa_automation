import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Check if any admin exists
  const adminCount = await prisma.admin.count();
  
  if (adminCount === 0) {
    // Create default admin user
    const hashedPassword = await bcrypt.hash('Ss123456', 10);
    
    const admin = await prisma.admin.create({
      data: {
        username: 'admin',
        password: hashedPassword,
      },
    });
    
    console.log('Created admin user:', admin.username);
  } else {
    console.log('Admin user already exists');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




