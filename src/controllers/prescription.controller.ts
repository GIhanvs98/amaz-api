import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { websocketService } from "../services/websocket.service.js";
import { billingService } from "../services/billing.service.js";
import { pharmacyService } from "../services/pharmacy.service.js";

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

    const labRequests = await prisma.labRequest.findMany({
      where: { visitId: prescription.visitId },
      include: { items: { include: { LabTest: true } } }
    });

    // Format like getPendingPrescriptions does
    const formatted = {
      id: prescription.id,
      patientId: prescription.patientId,
      visitId: prescription.visitId,
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
      })),
      labRequests: labRequests.map(lr => ({
        id: lr.id,
        status: lr.status,
        requestedAt: lr.requestedAt,
        tests: lr.items.map(item => item.LabTest?.name || "Unknown Test")
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

    if ((req as any).roleName === 'DOCTOR' && doctorId !== (req as any).user?.id) {
       res.status(403).json({ error: "Forbidden: You can only create prescriptions for yourself" });
       return;
    }

    const doctorUser = await prisma.user.findUnique({ where: { id: doctorId } });
    if (!doctorUser) {
      res.status(404).json({ error: "Doctor not found" });
      return;
    }
    const secureDoctorName = doctorUser.fullName;

    const newPrescription = await withRetry(async () => {
      return await (prisma as any).$transaction(async (tx: any) => {
        const rx = await tx.prescription.create({
          data: {
            patientId,
            patientName,
            visitId,
            doctorId,
            doctorName: secureDoctorName,
            diagnosis,
            clinicalNotes,
            items: {
              create: items ? items.map((item: any) => ({
                medicineId: item.medicineId || null,
                drugName: item.drugName,
                dosage: item.dosage,
                frequency: item.frequency,
                duration: item.duration,
                instructions: item.instructions,
                dispenseQty: item.dispenseQty || 1
              })) : []
            }
          },
          include: {
            items: true
          }
        });

        if (visitId) {
          // Add billing charge for POST-fee doctors
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
          // NOTE: Appointment status is NOT changed here. The doctor must explicitly
          // click "Complete Consultation" to remove the patient from the queue.
        }

        return rx;
      }, { maxWait: 20000, timeout: 20000 });
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

    const enrichedPrescriptions = await Promise.all((prescriptions as any[]).map(async (rx: any) => {
      let consultationPaid = false;
      let labRequestsData: any[] = [];
      if (rx.visitId) {
        const paidInvoice = await (prisma as any).invoice.findFirst({
          where: {
            visitId: rx.visitId,
            status: 'PAID',
            lineItems: { some: { department: 'CONSULTATION' } }
          }
        });
        if (paidInvoice) consultationPaid = true;

        const lrs = await (prisma as any).labRequest.findMany({
          where: { visitId: rx.visitId },
          include: { items: { include: { LabTest: true } } }
        });
        labRequestsData = lrs.map((lr: any) => ({
          id: lr.id,
          status: lr.status,
          requestedAt: lr.requestedAt,
          tests: lr.items.map((item: any) => item.LabTest?.name || "Unknown Test")
        }));
      }

      const doctor = await (prisma as any).user.findUnique({
        where: { id: rx.doctorId },
        select: { id: true, feeType: true, consultationFee: true, fullName: true }
      });

      return {
        ...rx,
        consultationPaid,
        doctor,
        labRequests: labRequestsData
      };
    }));

    res.json(enrichedPrescriptions);
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
        // Atomically guard against double-dispensing.
        // updateMany returns count=0 if the prescription is not in PENDING/IN_PROGRESS state.
        const guard = await tx.prescription.updateMany({
          where: { id, status: { in: ["PENDING", "IN_PROGRESS"] } },
          data: { status: "DISPENSED" }
        });

        if (guard.count === 0) {
          const existing = await tx.prescription.findUnique({ where: { id } });
          if (!existing) throw new Error("Prescription not found");
          if (existing.status === "DISPENSED") throw new Error("Prescription has already been dispensed. Cannot dispense again.");
          throw new Error(`Cannot dispense prescription in status: ${existing.status}`);
        }

        // Fetch the full prescription after status update
        const rx = await tx.prescription.findUnique({
          where: { id },
          include: { items: { include: { medicine: true } } }
        });

        let totalPharmacyCost = 0;

        // Update dispensed quantities and deduct stock
        if (dispensedItems && Array.isArray(dispensedItems)) {
          for (const di of dispensedItems) {
            let rxItem = await tx.prescriptionItem.findUnique({
              where: { id: di.itemId },
              include: { medicine: true }
            });

            if (rxItem?.medicineId && di.dispenseQty > 0) {
              // Delegate to pharmacyService for secure, locked FIFO deduction
              const dispenseResult = await pharmacyService.dispenseMedicine(
                rxItem.medicineId,
                di.dispenseQty,
                { skipBilling: true },
                tx
              );

              totalPharmacyCost += dispenseResult.totalCost;
              const actualDispensed = dispenseResult.batchesUsed.reduce((sum: number, b: any) => sum + b.quantityDispensed, 0);
              
              await tx.prescriptionItem.update({
                where: { id: di.itemId },
                data: { dispenseQty: actualDispensed }
              });
            } else if (rxItem) {
              await tx.prescriptionItem.update({
                where: { id: di.itemId },
                data: { dispenseQty: di.dispenseQty }
              });
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
      }, { maxWait: 20000, timeout: 20000 });
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

    const allowed = ["PENDING", "IN_PROGRESS", "CANCELLED"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `Invalid status. Dispensing must go through the dispense endpoint. Must be one of: ${allowed.join(", ")}` });
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
    const requestingUser = (req as any).user;
    const requestingRole = (req as any).roleName;
    const { doctorId } = req.query;

    let whereClause: any = {};
    if (doctorId) {
      whereClause.doctorId = String(doctorId);
    } else if (requestingRole === 'DOCTOR') {
      // Doctors can only see their own prescriptions unless filtering by doctorId (admin override not applicable)
      whereClause.doctorId = requestingUser?.id;
    }
    
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

    if ((req as any).roleName === 'DOCTOR' && rx.doctorId !== (req as any).user?.id) {
       res.status(403).json({ error: "Forbidden: You can only delete your own prescriptions" });
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

    if ((req as any).roleName === 'DOCTOR' && rx.doctorId !== (req as any).user?.id) {
       res.status(403).json({ error: "Forbidden: You can only edit your own prescriptions" });
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
                instructions: item.instructions,
                dispenseQty: item.dispenseQty || 1
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
