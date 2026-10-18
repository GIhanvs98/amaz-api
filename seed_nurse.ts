import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const roleName = 'Nurse';
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName, description: `${roleName} Role` },
  });

  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  await prisma.user.upsert({
    where: { email: 'nurse@amaz.com' },
    update: {
      roleId: role.id
    },
    create: {
      email: 'nurse@amaz.com',
      fullName: 'Nancy Nurse',
      password,
      roleId: role.id,
    },
  });

  console.log('Nurse seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
