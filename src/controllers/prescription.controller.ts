import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { websocketService } from "../services/websocket.service.js";
import { billingService } from "../services/billing.service.js";

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

export const getPrescriptionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prescription = await prisma.prescription.findUnique({
      where: { id: id as string },
      include: {
        Patient: { select: { fullName: true, phone: true } },
        items: {
          include: {
            medicine: {
              include: { stockBatches: { orderBy: { expiryDate: 'asc' }, take: 1 } }
            }
          }
        }
      }
    });

    if (!prescription) {
      return res.status(404).json({ success: false, error: "Prescription not found" });
    }

    // Format like getPendingPrescriptions does
    const formatted = {
      id: prescription.id,
      patientName: prescription.Patient.fullName,
      patientPhone: prescription.Patient.phone,
      doctorName: prescription.doctorName,
      status: prescription.status,
      createdAt: prescription.createdAt,
      items: prescription.items.map((i: any) => ({
        id: i.id,
        drugName: i.drugName,
        dosage: i.dosage,
        frequency: i.frequency,
        duration: i.duration,
        instructions: i.instructions,
        dispenseQty: i.dispenseQty,
        medicineId: i.medicineId,
        medicine: i.medicine ? {
          id: i.medicine.id,
          name: i.medicine.name,
          stockBatches: i.medicine.stockBatches
        } : null
      }))
    };

    res.json(formatted);
  } catch (error: any) {
    console.error("Error fetching prescription:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createPrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, patientName, visitId, doctorId, doctorName, diagnosis, clinicalNotes, items } = req.body;

    const newPrescription = await withRetry(async () => {
      return await (prisma as any).$transaction(async (tx: any) => {
        const rx = await tx.prescription.create({
          data: {
            patientId,
            patientName,
            visitId,
            doctorId,
            doctorName,
            diagnosis,
            clinicalNotes,
            items: {
              create: items ? items.map((item: any) => ({
                medicineId: item.medicineId || null,
                drugName: item.drugName,
                dosage: item.dosage,
                frequency: item.frequency,
                duration: item.duration,
                instructions: item.instructions
              })) : []
            }
          },
          include: {
            items: true
          }
        });

        if (visitId) {
          const doctor = await tx.user.findUnique({
            where: { id: doctorId },
            select: { consultationFee: true, feeType: true }
          });
          
          if (doctor?.feeType === "POST" || !doctor?.feeType) {
            await billingService.addCharge({
              visitId,
              patientId,
              department: "CONSULTATION",
              description: "Doctor Consultation Fee (Post)",
              quantity: 1,
              unitPrice: doctor?.consultationFee ?? 2500
            }, tx);
          }
        }

        return rx;
      });
    });

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
          include: { items: { include: { medicine: true } } }
        });

        let totalPharmacyCost = 0;

        // Update dispensed quantities and deduct stock
        if (dispensedItems && Array.isArray(dispensedItems)) {
          for (const di of dispensedItems) {
            const rxItem = await tx.prescriptionItem.update({
              where: { id: di.itemId },
              data: { dispenseQty: di.dispenseQty },
              include: { medicine: true }
            });

            if (rxItem.medicineId && di.dispenseQty > 0) {
              let remainingToDeduct = di.dispenseQty;
              const batches = await tx.stockBatch.findMany({
                where: { medicineId: rxItem.medicineId, currentQuantity: { gt: 0 } },
                orderBy: { expiryDate: 'asc' }
              });

              for (const batch of batches) {
                if (remainingToDeduct <= 0) break;
                const deductAmount = Math.min(batch.currentQuantity, remainingToDeduct);
                
                await tx.stockBatch.update({
                  where: { id: batch.id },
                  data: { currentQuantity: { decrement: deductAmount } }
                });
                
                totalPharmacyCost += (deductAmount * batch.unitPrice);
                remainingToDeduct -= deductAmount;
              }
            }
          }
        }

        // Add charge atomically in the same transaction
        if (totalPharmacyCost > 0 && rx.visitId) {
          await billingService.addCharge({
            visitId: rx.visitId,
            patientId: rx.patientId,
            department: "PHARMACY",
            referenceId: rx.id,
            description: "Pharmacy Medication Charge",
            quantity: 1,
            unitPrice: totalPharmacyCost
          }, tx);
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
