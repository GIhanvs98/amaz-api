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
      include: { Role: true },
    });

    if (!doctor || doctor.Role?.name !== "DOCTOR") {
      res.status(400).json({ error: "Invalid doctor selected" });
      return;
    }

    // Get today's appointments for this doctor to determine the sequence number
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tokensToday = await prisma.appointment.count({
      where: {
        doctorId,
        appointmentDate: {
          gte: today,
        },
      },
    });

    // Generate token number: First 3 letters of doctor's name + sequence
    const docPrefix = doctor.fullName.substring(0, 3).toUpperCase();
    const sequence = (tokensToday + 1).toString().padStart(3, "0");
    const tokenNumber = `${docPrefix}-${sequence}`;

    const appointment = await prisma.appointment.create({
      data: {
        tokenNumber,
        patientId,
        doctorId,
        status: "CHECKED_IN", // Mapping "waiting_for_counsiling_payment" or similar
      },
      include: {
        Patient: true,
        User: {
          select: { fullName: true }
        }
      }
    });

    // Map to frontend expected format
    res.status(201).json({
      ...appointment,
      patient: appointment.Patient,
      doctor: appointment.User
    });
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

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: doctorId as string,
        appointmentDate: {
          gte: today
        },
      },
      include: {
        Patient: true,
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Map to frontend expected format
    const mappedTokens = appointments.map(app => ({
      ...app,
      patient: app.Patient
    }));

    res.status(200).json(mappedTokens);
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

    // Find the most recent appointment for this patient and doctor today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointment = await prisma.appointment.findFirst({
      where: {
        patientId: patientId,
        doctorId: doctorId,
        appointmentDate: {
          gte: today
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!appointment) {
      res.status(404).json({ error: "No active token found for this patient and doctor today." });
      return;
    }

    const updatedApp = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status }
    });

    res.status(200).json(updatedApp);
  } catch (error) {
    console.error("Error updating token status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPendingPrescriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: "prescription_issued",
        appointmentDate: {
          gte: today
        }
      },
      include: {
        Patient: true,
        User: {
          select: { fullName: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    const mappedTokens = appointments.map(app => ({
      ...app,
      patient: app.Patient,
      doctor: app.User
    }));

    res.status(200).json(mappedTokens);
  } catch (error) {
    console.error("Error fetching pending prescriptions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
