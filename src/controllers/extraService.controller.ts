import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { clearCache } from "../middlewares/cache.middleware.js";


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
  }
};
