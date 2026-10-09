import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { clearCache } from "../middlewares/cache.middleware.js";

const prisma = new PrismaClient();

export const extraServiceController = {
  getServices: async (req: Request, res: Response) => {
    try {
      const { all } = req.query;
      const whereClause = all === "true" ? {} : { isActive: true };
      
      const services = await prisma.extraService.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }
      });
      res.json(services);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },

  createService: async (req: Request, res: Response) => {
    try {
      const { title, description, price, barcode, roomNumber } = req.body;
      
      if (!/^[a-zA-Z0-9-]{6,15}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be between 6 and 15 alphanumeric characters." });
      }

      const service = await prisma.extraService.create({
        data: {
          title,
          description,
          price: parseFloat(price),
          barcode,
          roomNumber
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
      const { title, description, price, barcode, roomNumber } = req.body;
      
      if (barcode && !/^[a-zA-Z0-9-]{6,15}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be between 6 and 15 alphanumeric characters." });
      }

      const service = await prisma.extraService.update({
        where: { id },
        data: {
          title,
          description,
          price: price !== undefined ? parseFloat(price) : undefined,
          barcode,
          roomNumber
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
