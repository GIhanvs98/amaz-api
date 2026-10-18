import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const result = await prisma.doctorScheduleSession.updateMany({
    where: { walkInPercentage: 100 },
    data: { walkInPercentage: 70 }
  });
  console.log("Updated sessions:", result.count);
}
run();
