import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function test() {
  try {
    console.log("Testing summary metrics...");
    const totalPatients = await prisma.patient.count();
    console.log("totalPatients:", totalPatients);

    const newPatientsToday = await prisma.patient.count({
      where: { createdAt: { gte: new Date(), lte: new Date() } }
    });
    console.log("newPatientsToday:", newPatientsToday);

    const totalAppointments = await prisma.appointment.count({
      where: { appointmentDate: { gte: new Date(), lte: new Date() } }
    });
    console.log("totalAppointments:", totalAppointments);

    const todaysPayments = await prisma.payment.aggregate({
      where: { createdAt: { gte: new Date(), lte: new Date() }, status: "COMPLETED" },
      _sum: { amount: true }
    });
    console.log("todaysPayments:", todaysPayments);

    const pendingLabs = await prisma.labRequest.count({
      where: { status: "PENDING" }
    });
    console.log("pendingLabs:", pendingLabs);

    const activeDoctorsCount = await prisma.doctorAttendance.count({
      where: { date: { gte: new Date(), lte: new Date() }, status: { in: ["ARRIVED", "IN_CONSULTATION"] } }
    });
    console.log("activeDoctorsCount:", activeDoctorsCount);

    const activeExtraServices = await prisma.extraService.count({
      where: { isActive: true }
    });
    console.log("activeExtraServices:", activeExtraServices);

    console.log("Testing medicines...");
    const medicines = await prisma.medicine.findMany({
      where: { isActive: true },
      include: { stockBatches: true }
    });
    console.log("medicines count:", medicines.length);

    console.log("Testing transactions...");
    const recentTransactions = await prisma.payment.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        invoice: {
          include: {
            lineItems: { take: 1, select: { description: true } }
          }
        }
      }
    });
    console.log("transactions count:", recentTransactions.length);

    console.log("All queries ran successfully!");
  } catch (error) {
    console.error("Error occurred:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
