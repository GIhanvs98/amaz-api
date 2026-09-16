import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { websocketService } from "../services/websocket.service.js";

const prisma = new PrismaClient();

// In case of transient NeonDB errors, wrapped execution:
const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && error.message?.includes("Can't reach database server")) {
      console.warn(`Database connection failed. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const createPrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, patientName, visitId, doctorId, doctorName, diagnosis, clinicalNotes, items } = req.body;

    const newPrescription = await withRetry(() => (prisma as any).prescription.create({
      data: {
        patientId,
        patientName,
        visitId,
        doctorId,
        doctorName,
        diagnosis,
        clinicalNotes,
        items: {
          create: items.map((item: any) => ({
            medicineId: item.medicineId || null,
            drugName: item.drugName,
            dosage: item.dosage,
            frequency: item.frequency,
            duration: item.duration,
            instructions: item.instructions
          }))
        }
      },
      include: {
        items: true
      }
    }));

    // Broadcast via WebSockets
    websocketService.broadcast("prescription_created", newPrescription);

    res.status(201).json(newPrescription);
  } catch (error) {
    console.error("Error creating prescription:", error);
    res.status(500).json({ error: "Failed to create prescription" });
  }
};

export const getPendingPrescriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const prescriptions = await withRetry(() => (prisma as any).prescription.findMany({
      where: { status: "PENDING" },
      include: {
        items: {
          include: {
            medicine: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }));
    res.json(prescriptions);
  } catch (error) {
    console.error("Error fetching prescriptions:", error);
    res.status(500).json({ error: "Failed to fetch prescriptions" });
  }
};

export const markPrescriptionDispensed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { dispensedItems } = req.body; // Array of { itemId, dispenseQty }

    const updated = await withRetry(async () => {
      return await (prisma as any).$transaction(async (tx: any) => {
        // Update prescription status
        const rx = await tx.prescription.update({
          where: { id },
          data: { status: "DISPENSED" },
          include: { items: true }
        });

        // Update dispensed quantities
        if (dispensedItems && Array.isArray(dispensedItems)) {
          for (const di of dispensedItems) {
            await tx.prescriptionItem.update({
              where: { id: di.itemId },
              data: { dispenseQty: di.dispenseQty }
            });
          }
        }
        return rx;
      });
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ error: "Failed to update prescription" });
  }
};
