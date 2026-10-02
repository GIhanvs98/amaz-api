import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const extraServiceController = {
  getServices: async (req: Request, res: Response) => {
    try {
      const services = await prisma.extraService.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(services);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },

  createService: async (req: Request, res: Response) => {
    try {
      const { title, description, price, barcode } = req.body;
      
      if (!/^\d{10}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be strictly 10 digits" });
      }

      const service = await prisma.extraService.create({
        data: {
          title,
          description,
          price: parseFloat(price),
          barcode
        }
      });
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
      const { title, description, price, barcode } = req.body;
      
      if (barcode && !/^\d{10}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be strictly 10 digits" });
      }

      const service = await prisma.extraService.update({
        where: { id },
        data: {
          title,
          description,
          price: price !== undefined ? parseFloat(price) : undefined,
          barcode
        }
      });
      res.json(service);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },

  deleteService: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await prisma.extraService.update({
        where: { id },
        data: { isActive: false }
      });
      res.json({ message: "Service deleted successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
