import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const appointments = await prisma.appointment.findMany({
    include: { Patient: true }
  });
  
  const today = appointments.filter(a => new Date(a.appointmentDate).toDateString() === new Date().toDateString());
  console.log(`Found ${today.length} appointments for today.`);
  
  for (const a of today) {
    if (a.Patient?.fullName === "Asitha L Konara") {
      console.log(`Token: ${a.tokenNumber}, Dept: ${a.department}, Ref: ${a.bookingReference}, Status: ${a.status}`);
      const invoices = await prisma.invoice.findMany({ where: { visitId: a.id }, include: { lineItems: true } });
      for (const inv of invoices) {
        console.log(`  Invoice ${inv.id} - ${inv.status}`);
        for (const li of inv.lineItems) {
          console.log(`    LineItem: ${li.description} - LKR ${li.unitPrice}`);
        }
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
