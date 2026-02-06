const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('admin123', 10);
  
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: { password: hash },
    create: { username: 'admin', password: hash }
  });
  
  console.log('✅ Admin created: admin / admin123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
