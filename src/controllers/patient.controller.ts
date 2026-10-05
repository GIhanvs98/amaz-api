import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const createOrGetPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, phone, age } = req.body;

    if (!fullName || !phone) {
      res.status(400).json({ error: "Please provide full name and phone number." });
      return;
    }

    let patient = await prisma.patient.findUnique({
      where: { phone },
    });

    if (patient) {
      if (patient.fullName !== fullName || patient.ageFallback !== age || !patient.isActive) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: { fullName, ageFallback: age ? parseInt(age.toString()) : null, isActive: true },
        });
      }
    } else {
      patient = await prisma.patient.create({
        data: {
          fullName,
          phone,
          ageFallback: age ? parseInt(age.toString()) : null,
        },
      });
    }

    res.status(200).json(patient);
  } catch (error) {
    console.error("Error creating/getting patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const searchPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone } = req.query;
    if (!phone) {
       res.status(400).json({ error: "Phone number query is required" });
       return;
    }

    const patient = await prisma.patient.findFirst({
      where: { phone: phone as string, isActive: true },
    });

    if (!patient) {
       res.status(404).json({ error: "Patient not found" });
       return;
    }
    res.status(200).json(patient);
  } catch(error) {
    console.error("Error searching patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllPatients = async (req: Request, res: Response): Promise<void> => {
  try {
    const patients = await prisma.patient.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(patients);
  } catch (error) {
    console.error("Error fetching all patients:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPatientById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
       res.status(400).json({ error: "Patient ID is required" });
       return;
    }

    const patient = await prisma.patient.findUnique({
      where: { id: id as string },
    });

    if (!patient) {
       res.status(404).json({ error: "Patient not found" });
       return;
    }
    res.status(200).json(patient);
  } catch(error) {
    console.error("Error fetching patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
       res.status(400).json({ error: "Patient ID is required" });
       return;
    }

    const { age, gender, bloodGroup, fullName, phone } = req.body;

    const patient = await prisma.patient.update({
      where: { id: id as string },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(age !== undefined && { ageFallback: parseInt(age) }),
        ...(gender !== undefined && { gender }),
        ...(bloodGroup !== undefined && { bloodGroup }),
      },
    });

    res.status(200).json(patient);
  } catch (error: any) {
    console.error("Error updating patient:", error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Phone number already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deletePatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
       res.status(400).json({ error: "Patient ID is required" });
       return;
    }

    // Check for constraints
    const patient = await prisma.patient.findUnique({
      where: { id: id as string },
      include: {
        _count: {
          select: { Appointment: true, LabRequests: true, Prescription: true }
        }
      }
    });

    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const count = (patient as any)._count;
    if (count.Appointment > 0 || count.LabRequests > 0 || count.Prescription > 0) {
      res.status(400).json({ error: "Cannot delete patient with existing records" });
      return;
    }

    await prisma.patient.update({ where: { id: id as string }, data: { isActive: false } });
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Error deleting patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
