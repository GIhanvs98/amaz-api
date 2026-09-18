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
      // Optionally update details if they changed
      if (patient.fullName !== fullName || patient.age !== age) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: { fullName, age: age ? parseInt(age.toString()) : null },
        });
      }
    } else {
      patient = await prisma.patient.create({
        data: {
          fullName,
          phone,
          age: age ? parseInt(age.toString()) : null,
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

    const patient = await prisma.patient.findUnique({
      where: { phone: phone as string },
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
}
