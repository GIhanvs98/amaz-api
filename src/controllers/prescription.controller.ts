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
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      include: {
        items: {
          include: {
            medicine: {
              include: {
                stockBatches: {
                  where: { currentQuantity: { gt: 0 } },
                  orderBy: { createdAt: 'asc' as const },
                  take: 1,
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' as const }
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

        // Mark corresponding Appointment as COMPLETED
        await tx.appointment.updateMany({
          where: { id: rx.visitId, status: { not: "COMPLETED" } },
          data: { status: "COMPLETED", completedAt: new Date() }
        });

        return rx;
      });
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ error: "Failed to update prescription" });
  }
};

/**
 * PATCH /prescriptions/:id/status
 * Updates prescription status to IN_PROGRESS, PENDING, or DISPENSED
 */
export const updatePrescriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: string };

    const allowed = ["PENDING", "IN_PROGRESS", "DISPENSED", "CANCELLED"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(", ")}` });
      return;
    }

    const updated = await withRetry(async () => {
      const rx = await (prisma as any).prescription.update({
        where: { id },
        data: { status },
      });

      if (status === "DISPENSED") {
        await (prisma as any).appointment.updateMany({
          where: { id: rx.visitId, status: { not: "COMPLETED" } },
          data: { status: "COMPLETED", completedAt: new Date() }
        });
      }

      return rx;
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating prescription status:", error);
    res.status(500).json({ error: "Failed to update prescription status" });
  }
};


export const getPrescriptionHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.query;
    const whereClause = doctorId ? { doctorId: String(doctorId) } : {};
    
    const prescriptions = await withRetry(() => (prisma as any).prescription.findMany({
      where: whereClause,
      include: {
        items: true
      },
      orderBy: { createdAt: 'desc' as const }
    }));
    res.json(prescriptions);
  } catch (error) {
    console.error("Error fetching prescription history:", error);
    res.status(500).json({ error: "Failed to fetch prescription history" });
  }
};


export const deletePrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // First check if it exists and what its status is
    const rx = await withRetry(() => (prisma as any).prescription.findUnique({
      where: { id }
    })) as any;
    
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot delete a prescription that has already been dispensed." });
      return;
    }
    
    // Delete items first (or let cascade handle it, but explicit is safer)
    await withRetry(async () => {
      return await (prisma as any).$transaction([
        (prisma as any).prescriptionItem.deleteMany({ where: { prescriptionId: id } }),
        (prisma as any).prescription.delete({ where: { id } })
      ]);
    });
    
    res.json({ success: true, message: "Prescription deleted successfully" });
  } catch (error) {
    console.error("Error deleting prescription:", error);
    res.status(500).json({ error: "Failed to delete prescription" });
  }
};


export const updatePrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { diagnosis, clinicalNotes } = req.body;
    
    // Check if it exists and what its status is
    const rx = await withRetry(() => (prisma as any).prescription.findUnique({
      where: { id }
    })) as any;
    
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot edit a prescription that has already been dispensed." });
      return;
    }
    
    const { items } = req.body;
    
    const updatedRx = await withRetry(async () => {
      return await (prisma as any).$transaction(async (tx: any) => {
        // 1. Delete all existing items
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } });
        
        // 2. Update the main prescription and recreate items
        return await tx.prescription.update({
          where: { id },
          data: {
            diagnosis,
            clinicalNotes,
            items: {
              create: (items || []).map((item: any) => ({
                medicineId: item.medicineId || null,
                drugName: item.drugName,
                dosage: item.dosage,
                frequency: item.frequency,
                duration: item.duration,
                instructions: item.instructions
              }))
            }
          },
          include: { items: true }
        });
      });
    });
    
    res.json(updatedRx);
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ error: "Failed to update prescription" });
  }
};
