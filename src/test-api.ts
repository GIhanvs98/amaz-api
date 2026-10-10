import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const roomId = "0f84d18f-0125-4863-8452-cb68b9448bfb";
  const startDate = "2026-10-10";
  const endDate = "2026-10-10";

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const sessions = await prisma.doctorScheduleSession.findMany({
    where: {
      OR: [
        { roomId: roomId },
        { roomId: null, schedule: { doctor: { roomId: roomId } } }
      ],
      isActive: true,
    },
    include: { schedule: { include: { doctor: { select: { fullName: true } } } } }
  });

  const results = [];
  let currentDate = new Date(start);
  while (currentDate <= end) {
    const dayIndex = currentDate.getDay();
    const daySessions = sessions.filter(s => s.dayOfWeek === dayIndex);
    
    for (const s of daySessions) {
       const validFrom = new Date(s.schedule.validFrom);
       validFrom.setHours(0, 0, 0, 0);
       if (currentDate < validFrom) continue;
       
       if (s.schedule.validUntil) {
          const validUntil = new Date(s.schedule.validUntil);
          validUntil.setHours(23, 59, 59, 999);
          if (currentDate > validUntil) continue;
       }
       
       const isoDate = currentDate.toISOString().split('T')[0];
       results.push({
          id: s.id + '-' + isoDate,
          date: isoDate,
          dayOfWeek: dayIndex,
          startTime: s.startTime,
          endTime: s.endTime,
          sessionName: s.sessionName,
          doctorName: s.schedule.doctor.fullName
       });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
