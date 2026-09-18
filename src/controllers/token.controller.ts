import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const generateToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, doctorId } = req.body;

    if (!patientId || !doctorId) {
      res.status(400).json({ error: "Please provide patientId and doctorId" });
      return;
    }

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { role: true },
    });

    if (!doctor || doctor.role.name !== "DOCTOR") {
      res.status(400).json({ error: "Invalid doctor selected" });
      return;
    }

    // Get today's tokens for this doctor to determine the sequence number
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tokensToday = await prisma.token.count({
      where: {
        doctorId,
        createdAt: {
          gte: today,
        },
      },
    });

    // Generate token number: First 3 letters of doctor's name + sequence
    const docPrefix = doctor.fullName.substring(0, 3).toUpperCase();
    const sequence = (tokensToday + 1).toString().padStart(3, "0");
    const tokenNumber = `${docPrefix}-${sequence}`;

    const token = await prisma.token.create({
      data: {
        tokenNumber,
        patientId,
        doctorId,
        status: "waiting_for_counsiling_payment",
      },
      include: {
        patient: true,
        doctor: {
          select: { fullName: true }
        }
      }
    });

    res.status(201).json(token);
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getDoctorQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.query;

    if (!doctorId) {
      res.status(400).json({ error: "doctorId query parameter is required" });
      return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tokens = await prisma.token.findMany({
      where: {
        doctorId: doctorId as string,
        createdAt: {
          gte: today
        },
        // For queue, we might want to return all today's tokens, or just the waiting ones. 
        // We'll return all and filter on frontend, or return specific statuses.
        // Let's return all today's tokens for this doctor.
      },
      include: {
        patient: true,
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.status(200).json(tokens);
  } catch (error) {
    console.error("Error fetching doctor queue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateTokenStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, doctorId, status } = req.body;

    if (!patientId || !doctorId || !status) {
      res.status(400).json({ error: "Please provide patientId, doctorId, and status" });
      return;
    }

    // Find the most recent token for this patient and doctor today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const token = await prisma.token.findFirst({
      where: {
        patientId: patientId,
        doctorId: doctorId,
        createdAt: {
          gte: today
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!token) {
      res.status(404).json({ error: "No active token found for this patient and doctor today." });
      return;
    }

    const updatedToken = await prisma.token.update({
      where: { id: token.id },
      data: { status }
    });

    res.status(200).json(updatedToken);
  } catch (error) {
    console.error("Error updating token status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPendingPrescriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tokens = await prisma.token.findMany({
      where: {
        status: "prescription_issued",
        createdAt: {
          gte: today
        }
      },
      include: {
        patient: true,
        doctor: {
          select: { fullName: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    res.status(200).json(tokens);
  } catch (error) {
    console.error("Error fetching pending prescriptions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
