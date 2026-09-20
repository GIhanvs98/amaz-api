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
        role: {
          name: role as string,
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: {
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
