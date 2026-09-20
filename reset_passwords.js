const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);
  
  await prisma.user.updateMany({
    data: { password }
  });
  
  console.log('All passwords reset to password123');
}

main().finally(() => prisma.$disconnect());
