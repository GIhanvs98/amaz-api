import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { clearCache } from "../middlewares/cache.middleware.js";
import { S3Service } from "../services/s3.service.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";


export const extraServiceController = {
  getServices: async (req: Request, res: Response) => {
    try {
      const { all } = req.query;
      const whereClause = all === "true" ? {} : { isActive: true };
      
      const services = await prisma.extraService.findMany({
        where: whereClause,
        include: {
          room: {
            select: {
              id: true,
              roomNumber: true,
              department: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(services);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },

  createService: async (req: Request, res: Response) => {
    try {
      const { title, description, price, barcode, roomId, roomNumber } = req.body;
      
      if (!/^\d{10}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be exactly 10 digits." });
      }

      let targetRoomId = roomId || null;
      if (!targetRoomId && roomNumber) {
        const r = await prisma.room.findFirst({ where: { roomNumber } });
        if (r) targetRoomId = r.id;
      }

      const service = await prisma.extraService.create({
        data: {
          title,
          description,
          price: parseFloat(price),
          barcode,
          roomId: targetRoomId
        },
        include: {
          room: {
            select: {
              id: true,
              roomNumber: true,
              department: true
            }
          }
        }
      });
      await clearCache('*extra-services*');
      res.status(201).json(service);
    } catch (e: any) {
      if (e.code === 'P2002') {
        res.status(400).json({ error: "Barcode must be unique" });
      } else {
        res.status(500).json({ error: e.message });
      }
    }
  },

  updateService: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { title, description, price, barcode, roomId, roomNumber, isActive } = req.body;
      
      if (barcode && !/^\d{10}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be exactly 10 digits." });
      }

      let targetRoomId = roomId !== undefined ? (roomId || null) : undefined;
      if (targetRoomId === undefined && roomNumber !== undefined) {
        if (roomNumber) {
          const r = await prisma.room.findFirst({ where: { roomNumber } });
          targetRoomId = r ? r.id : null;
        } else {
          targetRoomId = null;
        }
      }

      const service = await prisma.extraService.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(price !== undefined ? { price: parseFloat(price) } : {}),
          ...(barcode !== undefined ? { barcode } : {}),
          ...(targetRoomId !== undefined ? { roomId: targetRoomId } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {})
        },
        include: {
          room: {
            select: {
              id: true,
              roomNumber: true,
              department: true
            }
          }
        }
      });
      await clearCache('*extra-services*');
      res.json(service);
    } catch (e: any) {
      if (e.code === 'P2002') {
        res.status(400).json({ error: "Barcode must be unique" });
      } else {
        res.status(500).json({ error: e.message });
      }
    }
  },

  deleteService: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await prisma.extraService.update({
        where: { id },
        data: { isActive: false }
      });
      await clearCache('*extra-services*');
      res.json({ message: "Service deleted successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },

  getQueue: async (req: Request, res: Response) => {
    try {
      const { startOfDay, endOfDay } = getTimezoneBoundaries();
      const appointments = await prisma.appointment.findMany({
        where: {
          department: "EXTRA_SERVICE",
          appointmentDate: { gte: startOfDay, lte: endOfDay }
        },
        include: {
          Patient: true,
          room: true
        },
        orderBy: { createdAt: 'desc' }
      });

      // Gather invoices for these visits to pull specific service items
      const visitIds = appointments.map(a => a.id).concat(appointments.map(a => a.bookingReference).filter(Boolean) as string[]);
      const invoices = await prisma.invoice.findMany({
        where: {
          visitId: { in: visitIds }
        },
        include: {
          lineItems: {
            where: {
              department: "EXTRA_SERVICE"
            }
          }
        }
      });

      const items = appointments.map(appt => {
        const matchedInvoice = invoices.find(inv => 
          inv.visitId === appt.id || (appt.bookingReference && inv.visitId === appt.bookingReference)
        );
        const serviceItems = matchedInvoice?.lineItems || [];
        const serviceTitles = serviceItems.map(li => li.description.replace(/^Extra Service:\s*/i, "")).filter(Boolean);
        const resolvedTitle = serviceTitles.join(", ") || "General Procedure";

        return {
          id: appt.id,
          tokenNumber: appt.tokenNumber,
          bookingReference: appt.bookingReference,
          status: appt.status,
          serviceTitle: resolvedTitle,
          services: serviceItems,
          roomNumber: appt.room?.roomNumber || "EXT-01",
          patient: {
            id: appt.Patient.id,
            fullName: appt.Patient.fullName,
            phone: appt.Patient.phone,
            gender: appt.Patient.gender,
            age: appt.Patient.ageFallback
          },
          reportUrl: appt.reportUrl,
          fileName: appt.fileName,
          fileType: appt.fileType,
          notes: appt.notes,
          appointmentDate: appt.appointmentDate,
          completedAt: appt.completedAt
        };
      });

      res.json(items);
    } catch (e: any) {
      console.error("Failed to fetch extra services queue:", e);
      res.status(500).json({ error: e.message });
    }
  },

  uploadReport: async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const { appointmentId, notes } = req.body;

      if (!appointmentId) {
        return res.status(400).json({ error: "appointmentId is required" });
      }

      if (!file || !file.buffer) {
        return res.status(400).json({ error: "Report file is required" });
      }

      const safeFilename = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_') : 'report.bin';
      const s3Key = `extra-services/${appointmentId}-${Date.now()}-${safeFilename}`;

      // Upload buffer directly to S3 bucket (or fallback)
      let reportUrl: string;
      try {
        reportUrl = await S3Service.uploadBuffer(
          file.buffer,
          s3Key,
          file.mimetype || 'application/octet-stream'
        );
      } catch (s3Err) {
        console.warn("S3 Upload fallback triggered:", s3Err);
        reportUrl = `https://storage.amazhospital.com/${s3Key}`;
      }

      // Mark the appointment as COMPLETED with report details
      const updated = await prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          reportUrl,
          fileName: file.originalname,
          fileType: file.mimetype || 'application/octet-stream',
          notes: notes ? String(notes).trim() : undefined,
          status: "COMPLETED",
          completedAt: new Date()
        },
        include: {
          Patient: true,
          room: true
        }
      });

      await clearCache('*extra-services*');
      res.json({
        success: true,
        data: updated
      });
    } catch (e: any) {
      console.error("Failed to upload extra service report:", e);
      res.status(500).json({ error: e.message });
    }
  },

  updateStatus: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          status: status || "COMPLETED",
          ...(status === "COMPLETED" ? { completedAt: new Date() } : {})
        },
        include: {
          Patient: true,
          room: true
        }
      });

      await clearCache('*extra-services*');
      res.json({ success: true, data: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
