import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const barcodeController = {
  resolveBarcode: async (req: Request, res: Response) => {
    try {
      const code = req.params.code as string;
      
      if (!code) return res.status(400).json({ error: "Barcode is required" });

      // 1. Check if it's a UUID (36) or short Rx ID (8) for a prescription
      if (code.length === 36 || code.length === 8) {
        let prescription;
        
        if (code.length === 36) {
          prescription = await prisma.prescription.findUnique({
            where: { id: code },
            include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
          });
        } else {
          // Find by 8-char prefix
          prescription = await prisma.prescription.findFirst({
            where: { id: { startsWith: code } },
            include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
          });
        }
        
        if (prescription) {
          const doctor = await prisma.user.findUnique({
            where: { id: prescription.doctorId },
            select: { id: true, feeType: true, consultationFee: true, fullName: true }
          });

          let consultationPaid = false;
          if (prescription.visitId) {
             const paidInvoice = await prisma.invoice.findFirst({
                where: {
                   visitId: prescription.visitId,
                   status: 'PAID',
                   lineItems: { some: { department: 'CONSULTATION' } }
                }
             });
             if (paidInvoice) consultationPaid = true;
          }

          return res.json({ type: "PRESCRIPTION", data: { ...prescription, doctor, consultationPaid } });
        }
      }

      // 2. Check Medicine
      const medicine = await prisma.medicine.findFirst({
        where: {
          OR: [
            { barcode: code },
            { name: { equals: code, mode: 'insensitive' } }
          ]
        },
        include: { stockBatches: true }
      });
      if (medicine) {
        return res.json({ type: "MEDICINE", data: medicine });
      }

      // 3. Check Extra Service
      const extraService = await prisma.extraService.findUnique({
        where: { barcode: code }
      });
      if (extraService) {
        return res.json({ type: "EXTRA_SERVICE", data: extraService });
      }

      // 4. Check Appointment (for token barcodes)
      const appointment = await prisma.appointment.findUnique({
        where: { id: code },
        include: { Patient: true, User: true }
      });
      if (appointment) {
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

        const invoices = await prisma.invoice.findMany({
          where: { 
            visitId: { in: allAppointments.map(a => a.id) },
            status: "DRAFT" 
          },
          include: { lineItems: true }
        });

        let mergedInvoice = null;
        if (invoices.length > 0) {
          const mainInvoice = invoices[0]!;
          const otherInvoices = invoices.slice(1);

          if (otherInvoices.length > 0) {
            await prisma.$transaction(async (tx) => {
              for (const inv of otherInvoices) {
                await tx.invoiceLineItem.updateMany({
                  where: { invoiceId: inv.id },
                  data: { invoiceId: mainInvoice.id }
                });
                await tx.invoice.delete({ where: { id: inv.id } });
              }
              const newLineItems = await tx.invoiceLineItem.findMany({ where: { invoiceId: mainInvoice.id } });
              const newTotal = newLineItems.reduce((s: number, li: any) => s + li.total, 0);
              
              await tx.invoice.update({
                where: { id: mainInvoice.id },
                data: { subtotal: newTotal, totalAmount: newTotal }
              });
            });

            mergedInvoice = await prisma.invoice.findUnique({
              where: { id: mainInvoice.id },
              include: { lineItems: true }
            });
          } else {
            mergedInvoice = mainInvoice;
          }
        }

        const prescriptions = await prisma.prescription.findMany({
          where: { visitId: { in: allAppointments.map(a => a.id) } },
          include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
        });

        const paidInvoice = await prisma.invoice.findFirst({
           where: {
              visitId: appointment.id,
              status: 'PAID',
              lineItems: { some: { department: 'CONSULTATION' } }
           }
        });
        const consultationPaid = !!paidInvoice;

        return res.json({ type: "APPOINTMENT", data: { appointment, allAppointments, invoice: mergedInvoice, prescriptions, consultationPaid } });
      }

      // 5. Check Non-Med Inventory (also inside Medicine technically as itemType="CONSUMABLE")
      // Already handled by the Medicine check above.

      return res.status(404).json({ error: "Barcode not recognized in any hospital subsystem." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
