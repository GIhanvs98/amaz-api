import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { websocketService } from "../services/websocket.service.js";
import { billingService } from "../services/billing.service.js";
import { pharmacyService } from "../services/pharmacy.service.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";

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

export const VALID_FREQUENCIES = ["OD", "BD", "TDS", "QDS", "QID", "EOD", "STAT", "CUSTOM"] as const;
export const VALID_ROUTES = ["ORAL", "SUPPOSITORY", "IM", "IV", "SC", "OTHER"] as const;

export const calcDispenseQty = (item: any): number => {
  // If doctor specified an explicit quantity or dispenseQty (>= 1), honor it directly
  if (item.quantity != null && Number(item.quantity) >= 1) {
    return Math.ceil(Number(item.quantity));
  }
  if (item.dispenseQty != null && Number(item.dispenseQty) >= 1) {
    return Math.ceil(Number(item.dispenseQty));
  }

  // Parse dosage units per administration (e.g. 0.5 tablet, 1 tablet, 2 tablets)
  let unitsPerAdmin = 1;
  if (item.dosageAmount) {
    const parsed = parseFloat(String(item.dosageAmount));
    if (!isNaN(parsed) && parsed > 0) unitsPerAdmin = parsed;
  } else if (item.tabletsPerTime) {
    const parsed = parseFloat(String(item.tabletsPerTime));
    if (!isNaN(parsed) && parsed > 0) unitsPerAdmin = parsed;
  }

  const freq = String(item.frequency || "").trim().toUpperCase();

  // STAT is an immediate, single one-time dose. Duration does not multiply STAT.
  if (freq === "STAT" || freq.startsWith("STAT")) {
    return Math.max(1, Math.ceil(unitsPerAdmin));
  }

  // Parse duration in days
  const durStr = String(item.duration || "1").trim();
  const durMatch = durStr.match(/(\d+)/);
  let durMultiplier = 1;
  if (/month/i.test(durStr)) durMultiplier = 30;
  else if (/week/i.test(durStr)) durMultiplier = 7;
  const days = Math.max(1, (durMatch && durMatch[1] ? parseInt(durMatch[1], 10) : 1) * durMultiplier);

  // EOD (Every other day) - administered alternate days
  if (freq === "EOD" || freq.includes("EVERY OTHER DAY")) {
    const doses = Math.ceil(days / 2);
    return Math.max(1, Math.ceil(doses * unitsPerAdmin));
  }

  let timesPerDay = 1;
  if (item.timesPerDay) {
    const parsed = parseInt(String(item.timesPerDay), 10);
    if (!isNaN(parsed) && parsed > 0) timesPerDay = parsed;
  }

  if (freq === "OD" || freq === "ONCE DAILY") {
    timesPerDay = 1;
  } else if (freq === "BD" || freq === "BID" || freq === "TWICE DAILY") {
    timesPerDay = 2;
  } else if (freq === "TDS" || freq === "TID" || freq === "THREE TIMES DAILY") {
    timesPerDay = 3;
  } else if (freq === "QDS" || freq === "QID" || freq === "FOUR TIMES DAILY") {
    timesPerDay = 4;
  } else if (freq.includes("X DAY")) {
    const match = freq.match(/(\d+)\s*X\s*DAY(?:.*?\((\d+)\s*(?:TAB|TABLETS?|CAPS?|PILLS?)\))?/i);
    if (match) {
      if (match[1]) timesPerDay = parseInt(match[1], 10) || timesPerDay;
      if (match[2]) unitsPerAdmin = parseFloat(match[2]) || unitsPerAdmin;
    }
  } else if (freq.includes("TABLETS") && freq.includes("TIMES A DAY")) {
    const parts = freq.split("TABLETS,");
    unitsPerAdmin = parseFloat(parts[0]?.trim() || "1") || unitsPerAdmin;
    timesPerDay = parseInt(parts[1]?.split("TIMES A DAY")[0]?.trim() || "1", 10) || timesPerDay;
  } else if (/^\d+$/.test(freq)) {
    timesPerDay = parseInt(freq, 10) || timesPerDay;
  }

  const calculated = Math.ceil(timesPerDay * unitsPerAdmin * days);
  return calculated > 0 ? calculated : 1;
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

    const appt = prescription.visitId ? await prisma.appointment.findUnique({
      where: { id: prescription.visitId },
      select: { bookingReference: true }
    }) : null;

    // Format like getPendingPrescriptions does
    const formatted = {
      id: prescription.id,
      bookingReference: appt?.bookingReference || null,
      patientId: prescription.patientId,
      visitId: prescription.visitId,
      patientName: prescription.Patient.fullName,
      patientPhone: prescription.Patient.phone,
      doctorName: prescription.doctorName,
      status: prescription.status,
      diagnosis: prescription.diagnosis,
      clinicalNotes: prescription.clinicalNotes,
      consultationFee: (prescription as any).consultationFee ?? null,
      createdAt: prescription.createdAt,
      items: prescription.items.map((i: any) => ({
        id: i.id,
        prescriptionId: i.prescriptionId,
        drugName: i.drugName,
        strength: i.strength,
        dosageAmount: i.dosageAmount,
        doseUnit: i.doseUnit,
        dosage: i.dosage,
        frequency: i.frequency,
        route: i.route || "ORAL",
        duration: i.duration,
        startDate: i.startDate,
        endDate: i.endDate,
        instructions: i.instructions,
        quantity: i.quantity,
        status: i.status || "ACTIVE",
        dispenseQty: calcDispenseQty(i),
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
    let { patientId, patientName, visitId, doctorId, doctorName, diagnosis, clinicalNotes, items, consultationFee, customConsultationFee } = req.body;

    if (visitId) {
      const apptRecord = await prisma.appointment.findUnique({
        where: { id: visitId },
        include: { Patient: true }
      });
      if (apptRecord) {
        if (!doctorId && apptRecord.doctorId) doctorId = apptRecord.doctorId;
        if (!patientId && apptRecord.patientId) patientId = apptRecord.patientId;
        if (!patientName && apptRecord.Patient?.fullName) patientName = apptRecord.Patient.fullName;
      }
    }

    if (!doctorId) {
      doctorId = (req as any).user?.id;
    }

    if (!doctorId) {
      res.status(400).json({ error: "Doctor ID is required" });
      return;
    }

    if (!patientId) {
      res.status(400).json({ error: "Patient ID is required" });
      return;
    }

    if (!visitId) {
      res.status(400).json({ error: "Visit ID is required" });
      return;
    }

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

    if (!patientName) {
      const pRecord = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
      patientName = pRecord?.fullName || "Patient";
    }

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
            consultationFee: consultationFee !== undefined && Number(consultationFee) > 0 ? parseFloat(String(consultationFee)) : null,
            items: {
              create: items ? items.map((item: any) => {
                const calculatedQty = calcDispenseQty(item);
                const routeVal = item.route ? String(item.route).trim().toUpperCase() : "ORAL";
                const freqVal = item.frequency ? String(item.frequency).trim().toUpperCase() : "OD";
                return {
                  medicineId: item.medicineId || null,
                  drugName: item.drugName || item.name || "",
                  strength: item.strength ? String(item.strength).trim() : null,
                  dosageAmount: item.dosageAmount != null ? String(item.dosageAmount).trim() : null,
                  doseUnit: item.doseUnit ? String(item.doseUnit).trim() : null,
                  dosage: item.dosage || (item.dosageAmount && item.doseUnit ? `${item.dosageAmount} ${item.doseUnit}` : (item.dosageAmount ? String(item.dosageAmount) : "")),
                  frequency: freqVal,
                  route: routeVal,
                  duration: item.duration ? String(item.duration).trim() : null,
                  startDate: item.startDate ? new Date(item.startDate) : null,
                  endDate: item.endDate ? new Date(item.endDate) : null,
                  instructions: item.instructions ? String(item.instructions).trim() : null,
                  quantity: item.quantity != null ? parseInt(String(item.quantity), 10) : calculatedQty,
                  dispenseQty: calculatedQty,
                  status: item.status || "ACTIVE"
                };
              }) : []
            }
          },
          include: {
            items: true
          }
        });

        let appt: any = null;
        if (visitId) {
          // Check if consultation charge was already added or paid for this visit
          let visitIds = [visitId];
          appt = await tx.appointment.findUnique({
            where: { id: visitId },
            select: { bookingReference: true }
          });
          if (appt?.bookingReference) {
            const linked = await tx.appointment.findMany({
              where: { bookingReference: appt.bookingReference },
              select: { id: true }
            });
            visitIds = linked.map((l: any) => l.id);
          }

          const existingConsultation = await tx.invoiceLineItem.findFirst({
            where: {
              department: "CONSULTATION",
              invoice: {
                visitId: { in: visitIds },
                status: { in: ["DRAFT", "PAID"] }
              }
            }
          });

          const doctor = await tx.user.findUnique({
            where: { id: doctorId },
            select: { consultationFee: true, feeType: true, fullName: true }
          });

          const effectiveFee = (consultationFee !== undefined && Number(consultationFee) > 0)
            ? Number(consultationFee)
            : ((customConsultationFee !== undefined && customConsultationFee !== null && !isNaN(Number(customConsultationFee)))
              ? Number(customConsultationFee)
              : (doctorUser.consultationFee ?? doctor?.consultationFee ?? 2500));

          if (!existingConsultation) {
            // Add billing charge for POST-fee doctors
            if (doctorUser.feeType === "POST" || !doctorUser.feeType || doctor?.feeType === "POST") {
              await billingService.addCharge({
                visitId,
                patientId,
                department: "CONSULTATION",
                description: `Doctor Consultation Fee (Post) - Dr. ${secureDoctorName}`,
                quantity: 1,
                unitPrice: effectiveFee
              }, tx);
            }
          }

          if (req.body.extraServices && Array.isArray(req.body.extraServices)) {
            for (const svc of req.body.extraServices) {
              const targetPrice = Number(svc.customPrice !== undefined ? svc.customPrice : (svc.price ?? 0));
              await billingService.addCharge({
                visitId,
                patientId,
                department: "EXTRA_SERVICE",
                referenceId: svc.id,
                description: `Extra Service: ${svc.title}`,
                quantity: 1,
                unitPrice: targetPrice
              }, tx);
            }
          } else if (customConsultationFee !== undefined && customConsultationFee !== null && !isNaN(Number(customConsultationFee))) {
            // If already exists in a DRAFT invoice, update price to match doctor custom fee
            const draftInv = await tx.invoice.findFirst({
              where: { visitId: { in: visitIds }, status: "DRAFT" }
            });
            if (draftInv) {
              await tx.invoiceLineItem.updateMany({
                where: { invoiceId: draftInv.id, department: "CONSULTATION" },
                data: {
                  unitPrice: Number(customConsultationFee),
                  total: Number(customConsultationFee)
                }
              });
              const remainingItems = await tx.invoiceLineItem.findMany({
                where: { invoiceId: draftInv.id }
              });
              const newSubtotal = remainingItems.reduce((acc: number, item: any) => acc + item.total, 0);
              await tx.invoice.update({
                where: { id: draftInv.id },
                data: {
                  subtotal: newSubtotal,
                  totalAmount: Math.max(0, newSubtotal - (draftInv.discountAmount || 0))
                }
              });
            }
          }
          // NOTE: Appointment status is NOT changed here. The doctor must explicitly
          // click "Complete Consultation" to remove the patient from the queue.
        }

        return {
          ...rx,
          bookingReference: appt?.bookingReference || null
        };
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
    // Bound queue strictly to today (Asia/Colombo)
    const { startOfDay, endOfDay } = getTimezoneBoundaries();

    const prescriptions = await withRetry(() => (prisma as any).prescription.findMany({
      where: { 
        status: { in: ["PENDING", "IN_PROGRESS"] },
        createdAt: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        Patient: {
          select: {
            fullName: true,
            phone: true,
            dateOfBirth: true,
            ageFallback: true,
            gender: true
          }
        },
        items: {
          include: {
            medicine: {
              include: {
                stockBatches: {
                  where: { currentQuantity: { gt: 0 } },
                  orderBy: { expiryDate: 'asc' as const },
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' as const }
    }));

    const visitIds = Array.from(new Set((prescriptions as any[]).map((rx: any) => rx.visitId).filter(Boolean)));
    const doctorIds = Array.from(new Set((prescriptions as any[]).map((rx: any) => rx.doctorId).filter(Boolean)));

    const [appts, invoices, lrs, doctors] = await Promise.all([
      visitIds.length > 0 ? (prisma as any).appointment.findMany({
        where: { id: { in: visitIds } },
        select: { id: true, bookingReference: true }
      }) : [],
      visitIds.length > 0 ? (prisma as any).invoice.findMany({
        where: { visitId: { in: visitIds } },
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' }
      }) : [],
      visitIds.length > 0 ? (prisma as any).labRequest.findMany({
        where: { visitId: { in: visitIds } },
        include: { items: { include: { LabTest: true } } }
      }) : [],
      doctorIds.length > 0 ? (prisma as any).user.findMany({
        where: { id: { in: doctorIds } },
        select: { id: true, feeType: true, consultationFee: true, fullName: true }
      }) : []
    ]);

    const apptMap = new Map<string, any>(appts.map((a: any) => [a.id, a]));
    const invoicesByVisit = new Map<string, any[]>();
    for (const inv of invoices) {
      if (inv.visitId) {
        if (!invoicesByVisit.has(inv.visitId)) invoicesByVisit.set(inv.visitId, []);
        invoicesByVisit.get(inv.visitId)!.push(inv);
      }
    }
    const labRequestsByVisit = new Map<string, any[]>();
    for (const lr of lrs) {
      if (lr.visitId) {
        if (!labRequestsByVisit.has(lr.visitId)) labRequestsByVisit.set(lr.visitId, []);
        labRequestsByVisit.get(lr.visitId)!.push(lr);
      }
    }
    const doctorMap = new Map<string, any>(doctors.map((d: any) => [d.id, d]));

    const enrichedPrescriptions = (prescriptions as any[]).map((rx: any) => {
      let consultationPaid = false;
      let labRequestsData: any[] = [];
      let fullInvoiceStatus: string | null = null;
      const appt = rx.visitId ? apptMap.get(rx.visitId) : null;

      if (rx.visitId) {
        const invList = invoicesByVisit.get(rx.visitId) || [];
        if (invList.length > 0) {
          const draftInv = invList.find((inv: any) => inv.status === 'DRAFT');
          const paidInv = invList.find((inv: any) => inv.status === 'PAID');
          fullInvoiceStatus = draftInv ? 'DRAFT' : (paidInv ? 'PAID' : invList[0].status);

          consultationPaid = invList.some((inv: any) => 
            inv.status === 'PAID' && inv.lineItems?.some((li: any) => li.department === 'CONSULTATION')
          );
        }

        const visitLrs = labRequestsByVisit.get(rx.visitId) || [];
        labRequestsData = visitLrs.map((lr: any) => ({
          id: lr.id,
          status: lr.status,
          requestedAt: lr.requestedAt,
          tests: lr.items.map((item: any) => item.LabTest?.name || "Unknown Test")
        }));
      }

      const doctor = rx.doctorId ? doctorMap.get(rx.doctorId) || null : null;

      let patientAge = "N/A";
      if (rx.Patient?.dateOfBirth) {
        const diff = Date.now() - new Date(rx.Patient.dateOfBirth).getTime();
        const ageDate = new Date(diff);
        patientAge = Math.abs(ageDate.getUTCFullYear() - 1970).toString();
      } else if (rx.Patient?.ageFallback) {
        patientAge = rx.Patient.ageFallback.toString();
      }

      return {
        ...rx,
        patientName: rx.Patient?.fullName || rx.patientName || "Walk-in Patient",
        patientPhone: rx.Patient?.phone || "N/A",
        patientAge,
        items: (rx.items || []).map((i: any) => {
          const dispenseQty = calcDispenseQty(i);
          const batches = i.medicine?.stockBatches || [];
          const totalStock = batches.reduce((sum: number, b: any) => sum + (b.currentQuantity || 0), 0);
          const unitPrice = batches[0]?.unitPrice ?? 0;
          return {
            ...i,
            dispenseQty,
            totalStock,
            unitPrice
          };
        }),
        bookingReference: appt?.bookingReference || null,
        consultationPaid,
        invoiceStatus: fullInvoiceStatus,
        doctor,
        labRequests: labRequestsData
      };
    });

    // Filter out prescriptions that were automatically marked DISPENSED
    res.json(enrichedPrescriptions.filter(Boolean));
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

    const allowed = ["PENDING", "IN_PROGRESS", "CANCELLED", "DISPENSED", "COMPLETED", "EXPIRED"];
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

    // Notify connected terminals
    websocketService.broadcast("prescription_status_updated", updated);

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
    const { doctorId, date, startDate, endDate, status, search, visitId, patientId } = req.query;

    let whereClause: any = {};
    if (visitId) {
      whereClause.visitId = String(visitId);
    }
    if (patientId) {
      whereClause.patientId = String(patientId);
    }
    if (doctorId) {
      whereClause.doctorId = String(doctorId);
    } else if (requestingRole === 'DOCTOR') {
      whereClause.doctorId = requestingUser?.id;
    }

    if (status && status !== 'ALL') {
      whereClause.status = String(status);
    }

    if (date) {
      const { startOfDay, endOfDay } = getTimezoneBoundaries(new Date(String(date)));
      whereClause.createdAt = { gte: startOfDay, lte: endOfDay };
    } else if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        const { startOfDay } = getTimezoneBoundaries(new Date(String(startDate)));
        whereClause.createdAt.gte = startOfDay;
      }
      if (endDate) {
        const { endOfDay } = getTimezoneBoundaries(new Date(String(endDate)));
        whereClause.createdAt.lte = endOfDay;
      }
    }

    if (search) {
      const s = String(search).trim();
      whereClause.OR = [
        { id: { contains: s, mode: 'insensitive' } },
        { patientName: { contains: s, mode: 'insensitive' } },
        { doctorName: { contains: s, mode: 'insensitive' } }
      ];
    }
    
    const prescriptions = await withRetry(() => (prisma as any).prescription.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            medicine: true
          }
        }
      },
      orderBy: { createdAt: 'desc' as const }
    }));

    const enriched = await Promise.all(((prescriptions as any[]) || []).map(async (rx: any) => {
      let invoiceStatus: string | null = null;
      let labRequestsData: any[] = [];
      if (rx.visitId) {
        const inv = await (prisma as any).invoice.findFirst({
          where: { visitId: rx.visitId },
          select: { status: true, totalAmount: true }
        });
        if (inv) invoiceStatus = inv.status;

        const lrs = await (prisma as any).labRequest.findMany({
          where: { visitId: rx.visitId },
          include: { items: { include: { LabTest: true } } }
        });
        labRequestsData = lrs.map((lr: any) => ({
          id: lr.id,
          status: lr.status,
          tests: lr.items.map((item: any) => item.LabTest?.name || "Unknown Test")
        }));
      }

      return {
        ...rx,
        items: (rx.items || []).map((i: any) => ({
          ...i,
          dispenseQty: calcDispenseQty(i)
        })),
        invoiceStatus,
        labRequests: labRequestsData
      };
    }));

    res.json(enriched);
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
    const { diagnosis, clinicalNotes, items, consultationFee, customConsultationFee } = req.body;
    
    // Check if it exists and what its status is
    const rx = await withRetry(() => (prisma as any).prescription.findUnique({
      where: { id }
    })) as any;
    
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }

    if ((req as any).roleName === 'DOCTOR' && rx.doctorId && rx.doctorId !== (req as any).user?.id) {
       res.status(403).json({ error: "Forbidden: You can only edit your own prescriptions" });
       return;
    }
    
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot edit a prescription that has already been dispensed." });
      return;
    }

    // Pre-resolve missing medicineIds if drugName matches catalog
    const processedItems: any[] = [];
    for (const item of (items || [])) {
      if (!item) continue;
      const drugName = item.drugName || item.name;
      if (!drugName || !String(drugName).trim()) continue;

      let medId = item.medicineId || null;
      if (!medId) {
        const med = await withRetry(() => (prisma as any).medicine.findFirst({
          where: {
            OR: [
              { name: { equals: String(drugName).trim(), mode: 'insensitive' } },
              { genericName: { equals: String(drugName).trim(), mode: 'insensitive' } }
            ]
          }
        })) as any;
        if (med) medId = med.id;
      }

      const calculatedQty = calcDispenseQty(item);
      const routeVal = item.route ? String(item.route).trim().toUpperCase() : "ORAL";
      const freqVal = item.frequency ? String(item.frequency).trim().toUpperCase() : "OD";

      processedItems.push({
        medicineId: medId,
        drugName: String(drugName).trim(),
        strength: item.strength ? String(item.strength).trim() : null,
        dosageAmount: item.dosageAmount != null ? String(item.dosageAmount).trim() : null,
        doseUnit: item.doseUnit ? String(item.doseUnit).trim() : null,
        dosage: item.dosage || (item.dosageAmount && item.doseUnit ? `${item.dosageAmount} ${item.doseUnit}` : (item.dosageAmount ? String(item.dosageAmount) : "")),
        frequency: freqVal,
        route: routeVal,
        duration: item.duration ? String(item.duration).trim() : null,
        startDate: item.startDate ? new Date(item.startDate) : null,
        endDate: item.endDate ? new Date(item.endDate) : null,
        instructions: item.instructions ? String(item.instructions).trim() : null,
        quantity: item.quantity != null ? parseInt(String(item.quantity), 10) : calculatedQty,
        dispenseQty: calculatedQty,
        status: item.status || "ACTIVE"
      });
    }
    
    const updatedRx = await withRetry(async () => {
      return await (prisma as any).$transaction(async (tx: any) => {
        // 1. Delete all existing items
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } });
        
        // 2. Update the main prescription and recreate items with stockBatch relations
        const updated = await tx.prescription.update({
          where: { id },
          data: {
            diagnosis: diagnosis !== undefined ? diagnosis : rx.diagnosis,
            clinicalNotes: clinicalNotes !== undefined ? clinicalNotes : rx.clinicalNotes,
            consultationFee: consultationFee !== undefined && Number(consultationFee) > 0 
              ? parseFloat(String(consultationFee)) 
              : rx.consultationFee,
            items: {
              create: processedItems
            }
          },
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
            },
            Patient: true
          }
        });

        const doctor = rx.doctorId ? await tx.user.findUnique({
          where: { id: rx.doctorId },
          select: { id: true, feeType: true, consultationFee: true, fullName: true }
        }) : null;

        // Ensure consultation billing line item is present if not already added
        let bookingRef: string | null = null;
        if (rx.visitId) {
          let visitIds = [rx.visitId];
          const appt = await tx.appointment.findUnique({
            where: { id: rx.visitId },
            select: { bookingReference: true }
          });
          if (appt?.bookingReference) {
            bookingRef = appt.bookingReference;
            const linked = await tx.appointment.findMany({
              where: { bookingReference: appt.bookingReference },
              select: { id: true }
            });
            visitIds = linked.map((l: any) => l.id);
          }

          const existingConsultation = await tx.invoiceLineItem.findFirst({
            where: {
              department: "CONSULTATION",
              invoice: {
                visitId: { in: visitIds },
                status: { in: ["DRAFT", "PAID"] }
              }
            }
          });
          if (rx.doctorId) {
            const doctor = await tx.user.findUnique({
              where: { id: rx.doctorId },
              select: { consultationFee: true, feeType: true, fullName: true }
            });
            const effectiveFee = (consultationFee !== undefined && Number(consultationFee) > 0)
              ? Number(consultationFee)
              : ((customConsultationFee !== undefined && customConsultationFee !== null && !isNaN(Number(customConsultationFee)))
                ? Number(customConsultationFee)
                : (rx.consultationFee ?? doctor?.consultationFee ?? 2500));

            if (!existingConsultation) {
              if (doctor?.feeType === "POST" || !doctor?.feeType) {
                await billingService.addCharge({
                  visitId: rx.visitId,
                  patientId: rx.patientId,
                  department: "CONSULTATION",
                  description: `Doctor Consultation Fee (Post) - Dr. ${rx.doctorName || doctor?.fullName || ''}`.trim(),
                  quantity: 1,
                  unitPrice: effectiveFee
                }, tx);
              }
            }

            if (req.body.extraServices && Array.isArray(req.body.extraServices)) {
              for (const svc of req.body.extraServices) {
                const targetPrice = Number(svc.customPrice !== undefined ? svc.customPrice : (svc.price ?? 0));
                await billingService.addCharge({
                  visitId: rx.visitId,
                  patientId: rx.patientId,
                  department: "EXTRA_SERVICE",
                  referenceId: svc.id,
                  description: `Extra Service: ${svc.title}`,
                  quantity: 1,
                  unitPrice: targetPrice
                }, tx);
              }
            }
          } else if (customConsultationFee !== undefined && customConsultationFee !== null && !isNaN(Number(customConsultationFee))) {
            const draftInv = await tx.invoice.findFirst({
              where: { visitId: { in: visitIds }, status: "DRAFT" }
            });
            if (draftInv) {
              await tx.invoiceLineItem.updateMany({
                where: { invoiceId: draftInv.id, department: "CONSULTATION" },
                data: {
                  unitPrice: Number(customConsultationFee),
                  total: Number(customConsultationFee)
                }
              });
              const remainingItems = await tx.invoiceLineItem.findMany({
                where: { invoiceId: draftInv.id }
              });
              const newSubtotal = remainingItems.reduce((acc: number, item: any) => acc + item.total, 0);
              await tx.invoice.update({
                where: { id: draftInv.id },
                data: {
                  subtotal: newSubtotal,
                  totalAmount: Math.max(0, newSubtotal - (draftInv.discountAmount || 0))
                }
              });
            }
          }
        }

        const visitLrs = rx.visitId ? await tx.labRequest.findMany({
          where: { visitId: rx.visitId },
          include: { items: { include: { LabTest: true } } }
        }) : [];
        const labRequestsData = visitLrs.map((lr: any) => ({
          id: lr.id,
          status: lr.status,
          requestedAt: lr.requestedAt,
          tests: lr.items.map((item: any) => item.LabTest?.name || "Unknown Test")
        }));

        return {
          ...updated,
          patientName: updated.patientName || updated.Patient?.fullName || "Walk-in",
          doctorName: updated.doctorName || doctor?.fullName || "Doctor",
          bookingReference: bookingRef,
          doctor,
          labRequests: labRequestsData
        };
      }, { maxWait: 20000, timeout: 20000 });
    });
    
    // Broadcast via WebSockets to pharmacy and frontdesk
    websocketService.broadcast("prescription_created", updatedRx);
    websocketService.broadcast("prescription_updated", updatedRx);

    res.json(updatedRx);
  } catch (error: any) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ error: "Failed to update prescription", details: error?.message });
  }
};

export const addItemToPrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = req.body;
    const rx = (await withRetry(() => (prisma as any).prescription.findUnique({ where: { id } }))) as any;
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    if ((req as any).roleName === 'DOCTOR' && rx.doctorId && rx.doctorId !== (req as any).user?.id) {
      res.status(403).json({ error: "Forbidden: You can only edit your own prescriptions" });
      return;
    }
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot add items to a dispensed prescription" });
      return;
    }
    const drugName = item.drugName || item.name;
    if (!drugName || !String(drugName).trim()) {
      res.status(400).json({ error: "Medicine / Drug name is required" });
      return;
    }
    let medId = item.medicineId || null;
    if (!medId) {
      const med = await withRetry(() => (prisma as any).medicine.findFirst({
        where: {
          OR: [
            { name: { equals: String(drugName).trim(), mode: 'insensitive' } },
            { genericName: { equals: String(drugName).trim(), mode: 'insensitive' } }
          ]
        }
      })) as any;
      if (med) medId = med.id;
    }

    const calculatedQty = calcDispenseQty(item);
    const routeVal = item.route ? String(item.route).trim().toUpperCase() : "ORAL";
    const freqVal = item.frequency ? String(item.frequency).trim().toUpperCase() : "OD";

    const createdItem = await withRetry(() => (prisma as any).prescriptionItem.create({
      data: {
        prescriptionId: id,
        medicineId: medId,
        drugName: String(drugName).trim(),
        strength: item.strength ? String(item.strength).trim() : null,
        dosageAmount: item.dosageAmount != null ? String(item.dosageAmount).trim() : null,
        doseUnit: item.doseUnit ? String(item.doseUnit).trim() : null,
        dosage: item.dosage || (item.dosageAmount && item.doseUnit ? `${item.dosageAmount} ${item.doseUnit}` : (item.dosageAmount ? String(item.dosageAmount) : "")),
        frequency: freqVal,
        route: routeVal,
        duration: item.duration ? String(item.duration).trim() : null,
        startDate: item.startDate ? new Date(item.startDate) : null,
        endDate: item.endDate ? new Date(item.endDate) : null,
        instructions: item.instructions ? String(item.instructions).trim() : null,
        quantity: item.quantity != null ? parseInt(String(item.quantity), 10) : calculatedQty,
        dispenseQty: calculatedQty,
        status: item.status || "ACTIVE"
      },
      include: {
        medicine: true
      }
    }));

    websocketService.broadcast("prescription_updated", { prescriptionId: id, item: createdItem });
    res.status(201).json(createdItem);
  } catch (error: any) {
    console.error("Error adding item to prescription:", error);
    res.status(500).json({ error: "Failed to add item to prescription" });
  }
};

export const updatePrescriptionItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, itemId } = req.params;
    const item = req.body;
    const rx = (await withRetry(() => (prisma as any).prescription.findUnique({ where: { id } }))) as any;
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    if ((req as any).roleName === 'DOCTOR' && rx.doctorId && rx.doctorId !== (req as any).user?.id) {
      res.status(403).json({ error: "Forbidden: You can only edit your own prescriptions" });
      return;
    }
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot edit items on a dispensed prescription" });
      return;
    }

    const calculatedQty = calcDispenseQty(item);
    const updatedItem = await withRetry(() => (prisma as any).prescriptionItem.update({
      where: { id: itemId },
      data: {
        drugName: item.drugName ? String(item.drugName).trim() : undefined,
        strength: item.strength !== undefined ? (item.strength ? String(item.strength).trim() : null) : undefined,
        dosageAmount: item.dosageAmount !== undefined ? (item.dosageAmount != null ? String(item.dosageAmount).trim() : null) : undefined,
        doseUnit: item.doseUnit !== undefined ? (item.doseUnit ? String(item.doseUnit).trim() : null) : undefined,
        dosage: item.dosage !== undefined ? item.dosage : (item.dosageAmount && item.doseUnit ? `${item.dosageAmount} ${item.doseUnit}` : undefined),
        frequency: item.frequency ? String(item.frequency).trim().toUpperCase() : undefined,
        route: item.route ? String(item.route).trim().toUpperCase() : undefined,
        duration: item.duration !== undefined ? (item.duration ? String(item.duration).trim() : null) : undefined,
        startDate: item.startDate !== undefined ? (item.startDate ? new Date(item.startDate) : null) : undefined,
        endDate: item.endDate !== undefined ? (item.endDate ? new Date(item.endDate) : null) : undefined,
        instructions: item.instructions !== undefined ? (item.instructions ? String(item.instructions).trim() : null) : undefined,
        quantity: item.quantity !== undefined ? (item.quantity != null ? parseInt(String(item.quantity), 10) : calculatedQty) : undefined,
        dispenseQty: calculatedQty,
        status: item.status !== undefined ? item.status : undefined
      },
      include: {
        medicine: true
      }
    }));

    websocketService.broadcast("prescription_updated", { prescriptionId: id, item: updatedItem });
    res.json(updatedItem);
  } catch (error: any) {
    console.error("Error updating prescription item:", error);
    res.status(500).json({ error: "Failed to update prescription item" });
  }
};

export const deletePrescriptionItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, itemId } = req.params;
    const rx = (await withRetry(() => (prisma as any).prescription.findUnique({ where: { id } }))) as any;
    if (!rx) {
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    if ((req as any).roleName === 'DOCTOR' && rx.doctorId && rx.doctorId !== (req as any).user?.id) {
      res.status(403).json({ error: "Forbidden: You can only edit your own prescriptions" });
      return;
    }
    if (rx.status === "DISPENSED") {
      res.status(400).json({ error: "Cannot delete items from a dispensed prescription" });
      return;
    }

    await withRetry(() => (prisma as any).prescriptionItem.delete({
      where: { id: itemId }
    }));

    websocketService.broadcast("prescription_updated", { prescriptionId: id, deletedItemId: itemId });
    res.json({ success: true, message: "Medicine item deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting prescription item:", error);
    res.status(500).json({ error: "Failed to delete prescription item" });
  }
};
