import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { generateMRN } from "../utils/mrn.util.js";

const prisma = new PrismaClient();

export const createOrGetPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, phone, age } = req.body;

    if (!fullName || !phone) {
      res.status(400).json({ error: "Please provide full name and phone number." });
      return;
    }

    let patient = await prisma.patient.findFirst({
      where: { phone, fullName },
    });

    if (patient) {
      if (!patient.isActive) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: { isActive: true },
        });
      }
    } else {
      const patientId = await generateMRN(prisma);
      patient = await prisma.patient.create({
        data: {
          patientId,
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
    const { phone, query } = req.query;
    const searchTerm = query || phone;
    
    if (!searchTerm) {
       res.status(400).json({ error: "Search term is required" });
       return;
    }

    const patients = await prisma.patient.findMany({
      where: { 
        isActive: true,
        OR: [
          { phone: { contains: searchTerm as string, mode: 'insensitive' } },
          { fullName: { contains: searchTerm as string, mode: 'insensitive' } },
          { patientId: { contains: searchTerm as string, mode: 'insensitive' } },
          { nic: { contains: searchTerm as string, mode: 'insensitive' } }
        ]
      },
      take: 10
    });

    // If frontend expects a single object for legacy phone search, we can return the first match
    if (phone && !query && patients.length > 0) {
      res.status(200).json(patients[0]);
      return;
    }
    
    res.status(200).json(patients);
  } catch(error) {
    console.error("Error searching patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllPatients = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.patient.count({ where: { isActive: true } })
    ]);
    
    res.status(200).json({
      data: patients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
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

    const { age, gender, bloodGroup, fullName, phone, emergencyContact, nic, dateOfBirth, address } = req.body;

    const patient = await prisma.patient.update({
      where: { id: id as string },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(age !== undefined && { ageFallback: parseInt(age) }),
        ...(gender !== undefined && { gender }),
        ...(bloodGroup !== undefined && { bloodGroup }),
        ...(emergencyContact !== undefined && { emergencyContact }),
        ...(nic !== undefined && { nic }),
        ...(dateOfBirth !== undefined && { dateOfBirth: new Date(dateOfBirth) }),
        ...(address !== undefined && { address }),
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
