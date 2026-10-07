import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const apt = await prisma.appointment.findFirst();
  if(!apt) return console.log("No apt");
  console.log("Apt:", apt.id);
  
  const allAppointments = [apt];
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: { visitId: { in: allAppointments.map(a => a.id) } },
      include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
    });
    console.log("Prescriptions fetched:", prescriptions.length);
  } catch (err) {
    console.error("Prisma error:", err);
  }
}
main().finally(() => prisma.$disconnect());
