import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function clean() {
  const invoices = await prisma.invoice.findMany({ where: { status: 'DRAFT' }, include: { lineItems: true, Appointment: true } });
  for (const inv of invoices) {
    if (inv.Appointment && inv.Appointment.department === 'LAB' && inv.Appointment.bookingReference) {
      console.log('Deleting duplicate lab invoice:', inv.id);
      await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: inv.id } });
      await prisma.invoice.delete({ where: { id: inv.id } });
    }
  }
}
clean().catch(console.error).finally(() => prisma.$disconnect());
