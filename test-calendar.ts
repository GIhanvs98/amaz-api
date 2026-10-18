import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const doctor = await prisma.user.findFirst({ where: { Role: { name: 'Doctor' } } });
  if (!doctor) return console.log('No doctor');
  
  const startDate = new Date('2026-10-01T00:00:00.000Z');
  const nextMonth = new Date('2026-11-01T00:00:00.000Z');

  const schedules = await prisma.doctorSchedule.findMany({
    where: { doctorId: doctor.id, validFrom: { lt: nextMonth }, OR: [{ validUntil: null }, { validUntil: { gte: startDate } }] },
    include: {
      sessions: { where: { isActive: true }, include: { room: true } }
    }
  });

  console.log(JSON.stringify(schedules, null, 2));
}

main();
