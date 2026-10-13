import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const barcodeController = {
  resolveBarcode: async (req: Request, res: Response) => {
    try {
      const rawCode = req.params.code as string;
      if (!rawCode) return res.status(400).json({ error: "Barcode is required" });
      const code = rawCode.trim();

      // 1. Check Prescription (UUID 36, or prefix 8/10)
      if (code.length === 36 || code.length === 10 || code.length === 8) {
        let prescription = null;
        if (code.length === 36) {
          prescription = await prisma.prescription.findUnique({
            where: { id: code },
            include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
          });
        } else {
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

      // 2. Check Medicine by barcode or exact name
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
      const extraService = await prisma.extraService.findFirst({
        where: {
          OR: [
            { barcode: code },
            { title: { equals: code, mode: 'insensitive' } }
          ]
        }
      });
      if (extraService) {
        return res.json({ type: "EXTRA_SERVICE", data: extraService });
      }

      // 4. Check Appointment / Token / Booking Reference
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const appointmentOrConditions: any[] = [
        { bookingReference: code },
        { id: code }
      ];

      if (code.length >= 8) {
        appointmentOrConditions.push({ id: { startsWith: code } });
      }

      if (/^\d{1,3}$/.test(code)) {
        appointmentOrConditions.push({
          tokenNumber: code.padStart(2, "0"),
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: { not: "CANCELLED" }
        });
      }

      let appointment = await prisma.appointment.findFirst({
        where: {
          OR: appointmentOrConditions
        },
        include: { Patient: true, User: true },
        orderBy: { createdAt: 'desc' }
      });

      // 5. If not found by appointment directly, check if it's an Invoice ID
      if (!appointment) {
        const invoice = await prisma.invoice.findFirst({
          where: {
            OR: [
              { id: code },
              ...(code.length >= 8 ? [{ id: { startsWith: code } }] : [])
            ]
          },
          include: { lineItems: true }
        });

        if (invoice && invoice.visitId) {
          appointment = await prisma.appointment.findUnique({
            where: { id: invoice.visitId },
            include: { Patient: true, User: true }
          });
        }
      }

      // 5.5 If still not found, check if code is a 10-digit Unix timestamp (from receipt printed via Date.now())
      if (!appointment && /^\d{10}$/.test(code)) {
        const ts = Number(code);
        if (ts >= 1700000000 && ts <= 1950000000) {
          const date = new Date(ts * 1000);
          const timeWindowStart = new Date(date.getTime() - 120000);
          const timeWindowEnd = new Date(date.getTime() + 120000);

          const invoiceByTime = await prisma.invoice.findFirst({
            where: {
              createdAt: { gte: timeWindowStart, lte: timeWindowEnd }
            },
            include: { lineItems: true },
            orderBy: { createdAt: 'desc' }
          });

          if (invoiceByTime && invoiceByTime.visitId) {
            appointment = await prisma.appointment.findUnique({
              where: { id: invoiceByTime.visitId },
              include: { Patient: true, User: true }
            });
          }
        }
      }

      if (appointment) {
        // Fetch all appointments connected to this visit (do NOT exclude COMPLETED so post-pay works!)
        let allAppointments: any[] = [];
        if (appointment.bookingReference) {
          allAppointments = await prisma.appointment.findMany({
            where: {
              bookingReference: appointment.bookingReference,
              status: { not: "CANCELLED" }
            },
            include: { Patient: true, User: true },
            orderBy: { createdAt: 'asc' }
          });
        } else {
          const apptDate = new Date(appointment.appointmentDate);
          const apptStart = new Date(apptDate);
          apptStart.setHours(0, 0, 0, 0);
          const apptEnd = new Date(apptDate);
          apptEnd.setHours(23, 59, 59, 999);

          allAppointments = await prisma.appointment.findMany({
            where: {
              patientId: appointment.patientId,
              appointmentDate: { gte: apptStart, lte: apptEnd },
              status: { not: "CANCELLED" }
            },
            include: { Patient: true, User: true },
            orderBy: { createdAt: 'asc' }
          });
        }

        if (allAppointments.length === 0) {
          allAppointments = [appointment];
        }

        const allApptIds = allAppointments.map(a => a.id);

        // Fetch DRAFT invoices linked to this visit
        const invoices = await prisma.invoice.findMany({
          where: {
            visitId: { in: allApptIds },
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

        // Fetch prescriptions created during this visit
        const prescriptions = await prisma.prescription.findMany({
          where: {
            OR: [
              { visitId: { in: allApptIds } },
              {
                patientId: appointment.patientId,
                createdAt: { gte: startOfDay, lte: endOfDay }
              }
            ]
          },
          include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
        });

        // Check if consultation fee was already paid
        const paidInvoice = await prisma.invoice.findFirst({
          where: {
            visitId: { in: allApptIds },
            status: 'PAID',
            lineItems: { some: { department: 'CONSULTATION' } }
          }
        });
        const consultationPaid = !!paidInvoice;

        // Pick primary consultation appointment if present in allAppointments
        const consultAppt = allAppointments.find(a => a.department === "CONSULTATION") || appointment;

        return res.json({
          type: "APPOINTMENT",
          data: {
            appointment: consultAppt,
            allAppointments,
            invoice: mergedInvoice,
            prescriptions,
            consultationPaid
          }
        });
      }

      return res.status(404).json({ error: "Barcode not recognized in any hospital subsystem." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
