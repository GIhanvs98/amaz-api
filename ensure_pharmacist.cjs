const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  let role = await prisma.role.findFirst({
    where: { name: { equals: 'Pharmacist', mode: 'insensitive' } }
  });

  if (!role) {
    role = await prisma.role.create({
      data: {
        name: 'Pharmacist',
        description: 'Pharmacist Role'
      }
    });
    console.log('Created Pharmacist role:', role.id);
  } else {
    console.log('Found Pharmacist role:', role.id);
  }

  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  const existingUser = await prisma.user.findFirst({
    where: { email: 'pharmacist@amaz.com' }
  });

  if (!existingUser) {
    const user = await prisma.user.create({
      data: {
        email: 'pharmacist@amaz.com',
        fullName: 'Peter Pharmacist',
        password,
        roleId: role.id
      }
    });
    console.log('Created user pharmacist@amaz.com:', user.id);
  } else {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { password, roleId: role.id }
    });
    console.log('Updated user pharmacist@amaz.com with Pharmacist role');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

