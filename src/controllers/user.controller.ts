import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getUsersByRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.query;

    if (!role) {
      res.status(400).json({ error: "Role query parameter is required" });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        Role: {
          name: role as string,
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        Role: {
          select: { name: true }
        }
      },
    });

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users by role:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

import { UserService } from "../services/user.service.js";
const userService = new UserService();

export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const profile = await userService.getProfile(userId);
    res.json(profile);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const profile = await userService.updateProfile(userId, req.body);
    res.json(profile);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updatePassword = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }

    const result = await userService.updatePassword(userId, currentPassword, newPassword);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
