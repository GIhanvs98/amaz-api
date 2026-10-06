import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function clean() {
  const invoices = await prisma.invoice.findMany({ where: { status: 'DRAFT' }, include: { lineItems: true } });
  let count = 0;
  for (const inv of invoices) {
    if (inv.visitId) {
      const appt = await prisma.appointment.findUnique({ where: { id: inv.visitId } });
      if (appt && appt.department === 'LAB' && appt.bookingReference) {
        console.log('Deleting duplicate lab invoice:', inv.id);
        await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: inv.id } });
        await prisma.invoice.delete({ where: { id: inv.id } });
        count++;
      }
    }
  }
  console.log('Deleted duplicate invoices:', count);
}
clean().catch(console.error).finally(() => prisma.$disconnect());
