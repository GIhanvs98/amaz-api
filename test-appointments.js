const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const apts = await prisma.appointment.findMany({ where: { status: 'CONSULTATION' } });
  console.log('CONSULTATION apts:', apts.length);
}
run();
