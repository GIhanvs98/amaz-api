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
          return res.json({ type: "PRESCRIPTION", data: { ...prescription, doctor } });
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
        let allAppointments = [appointment];
        if (appointment.bookingReference) {
          allAppointments = await prisma.appointment.findMany({
            where: { bookingReference: appointment.bookingReference },
            include: { Patient: true, User: true }
          });
        }

        const invoice = await prisma.invoice.findFirst({
          where: { visitId: appointment.id, status: "DRAFT" },
          include: { lineItems: true }
        });
        return res.json({ type: "APPOINTMENT", data: { appointment, allAppointments, invoice } });
      }

      // 5. Check Non-Med Inventory (also inside Medicine technically as itemType="CONSUMABLE")
      // Already handled by the Medicine check above.

      return res.status(404).json({ error: "Barcode not recognized in any hospital subsystem." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
