import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getRoleTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await prisma.rolePayrollTemplate.findMany();
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createRoleTemplate = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const template = await prisma.rolePayrollTemplate.create({
      data
    });
    res.json(template);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateRoleTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const template = await prisma.rolePayrollTemplate.update({
      where: { id: id as string },
      data
    });
    res.json(template);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteRoleTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.rolePayrollTemplate.delete({
      where: { id: id as string }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
