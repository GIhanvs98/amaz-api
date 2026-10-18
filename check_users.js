const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({ include: { Role: true } });
  console.log("Users in DB:");
  users.forEach(u => {
    console.log(`Email: ${u.email}, Role: ${u.Role?.name}, ID: ${u.id}`);
  });
}
check().finally(() => prisma.$disconnect());
