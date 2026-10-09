import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const code = "412515d3-995f-45ab-9a53-14afe23c3fe2";
  const appointment = await prisma.appointment.findUnique({
    where: { id: code },
    include: { Patient: true, User: true }
  });
  if (!appointment) return console.log("Not found");
  
  const startOfDay = new Date(appointment.appointmentDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(appointment.appointmentDate);
  endOfDay.setHours(23, 59, 59, 999);

  const allAppointments = await prisma.appointment.findMany({
    where: { 
      patientId: appointment.patientId,
      appointmentDate: { gte: startOfDay, lte: endOfDay },
      status: { notIn: ["CANCELLED", "COMPLETED"] } // Only fetch active ones
    },
    include: { Patient: true, User: true }
  });

  console.log("Appointments:", allAppointments.length);

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
