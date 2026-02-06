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

  // Seed learned click for NEXT button (coordinates from capture/automation logs: 540, 1656)
  try {
    await prisma.$executeRaw`
      INSERT INTO learned_clicks (id, button_type, x, y, success_count, last_used, created_at, updated_at)
      VALUES (gen_random_uuid()::text, 'NEXT', 540, 1656, 1, NOW(), NOW(), NOW())
      ON CONFLICT (button_type) DO UPDATE SET x = 540, y = 1656, updated_at = NOW()
    `;
    console.log('NEXT button coordinates (540, 1656) seeded for automation');
  } catch {
    // Table or columns may differ
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




