import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const doctorId = "bfd06502-2c11-450b-a4e2-99e20054a4a1";
  const date = "2026-10-03";
  const dayOfWeek = new Date(date).getDay();
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  console.log({dayOfWeek, startOfDay, endOfDay});

  const session = await prisma.doctorScheduleSession.findFirst({
    where: { 
      dayOfWeek, 
      isActive: true,
      schedule: {
        doctorId,
        validFrom: { lte: endOfDay },
        OR: [
          { validUntil: null },
          { validUntil: { gte: startOfDay } }
        ]
      }
    }
  });

  console.log("Session:", session);
}

main().catch(console.error);
