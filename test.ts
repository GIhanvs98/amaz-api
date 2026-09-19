import { prisma } from "./src/lib/prisma.js";

async function main() {
  const doctors = await prisma.user.findMany({ where: { Role: { name: 'DOCTOR' } } });
  for (const doc of doctors) {
    console.log("DOCTOR:", doc.fullName, doc.id);
    const schedules = await prisma.doctorSchedule.findMany({
      where: { doctorId: doc.id },
      include: { sessions: true }
    });
    console.log(JSON.stringify(schedules, null, 2));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
