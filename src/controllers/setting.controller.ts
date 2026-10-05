import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { clearCache } from "../middlewares/cache.middleware.js";

const prisma = new PrismaClient();

export const getSettings = async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany();
    // Convert array of {key, value} to an object
    const settingsObj = settings.reduce((acc: Record<string, string>, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json({ success: true, data: settingsObj });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const updates = req.body; // e.g. { hospitalName: "AMAZ", currency: "usd" }
    
    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) => {
        return prisma.systemSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value), description: `Setting for ${key}` }
        });
      })
    );

    await clearCache('*settings*');
    res.json({ success: true, message: "Settings saved successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
