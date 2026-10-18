import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.doctorScheduleSession.findMany({
    where: { isActive: true },
    include: { schedule: { include: { doctor: true } }, room: true }
  });
  console.log(JSON.stringify(sessions, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
