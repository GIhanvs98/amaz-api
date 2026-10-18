import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const sessions = await prisma.doctorScheduleSession.findMany({
    select: {
      id: true,
      dayOfWeek: true,
      tokenCapacity: true,
      walkInPercentage: true,
      schedule: { select: { doctor: { select: { fullName: true } } } }
    }
  });
  console.log(JSON.stringify(sessions, null, 2));
}
run();
