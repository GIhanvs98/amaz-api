import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// GET /api/finance/doctor-statements
export const getDoctorStatements = async (req: Request, res: Response) => {
  try {
    const { doctorId, status, startDate, endDate } = req.query;

    const where: any = {};
    if (doctorId) where.doctorId = String(doctorId);
    if (status) where.status = String(status);
    if (startDate || endDate) {
      where.periodStart = {};
      if (startDate) where.periodStart.gte = new Date(String(startDate));
      if (endDate) where.periodEnd = { lte: new Date(String(endDate)) };
    }

    const statements = await prisma.doctorPaymentStatement.findMany({
      where,
      include: {
        doctor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            specialty: true,
            Department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    });

    res.json({ success: true, data: statements });
  } catch (error: any) {
    console.error("Error fetching doctor statements:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/finance/doctor-statements/generate
export const generateDoctorStatements = async (req: Request, res: Response) => {
  try {
    const { periodStart, periodEnd, doctorId, commissionRate: inputCommissionRate, commissionType: inputCommissionType } = req.body;
    const authUser = (req as any).user;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ success: false, error: "periodStart and periodEnd are required" });
    }

    const start = new Date(periodStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);

    // 1. Find doctors (either specific or all active doctors with specialties)
    const doctorWhere: any = { isActive: true };
    if (doctorId) {
      doctorWhere.id = doctorId;
    } else {
      doctorWhere.specialty = { not: null };
    }

    const doctors = await prisma.user.findMany({
      where: doctorWhere,
      include: { Department: true },
    });

    const createdStatements = [];

    for (const doc of doctors) {
      // Find completed appointments in range
      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId: doc.id,
          status: "COMPLETED",
          OR: [
            { completedAt: { gte: start, lte: end } },
            { appointmentDate: { gte: start, lte: end } },
            { createdAt: { gte: start, lte: end } }
          ],
        },
        select: { id: true },
      });

      const visitIds = appointments.map(a => a.id);

      // Find paid invoices for these visits
      const paidInvoices: any[] = await prisma.invoice.findMany({
        where: {
          visitId: { in: visitIds },
          status: "PAID",
        },
        include: {
          lineItems: true,
          payments: {
            include: {
              refunds: { where: { status: "COMPLETED" } },
            },
          },
        },
      });

      let totalCollected = 0;
      let totalConsultations = 0;

      for (const inv of paidInvoices) {
        const consultItem = inv.lineItems?.find((li: any) => li.department === "CONSULTATION");
        if (consultItem) {
          const totalRefunds = inv.payments?.reduce((sum: number, p: any) =>
            sum + (p.refunds?.reduce((rSum: number, r: any) => rSum + r.amount, 0) || 0), 0) || 0;
          
          const netRevenue = Math.max(0, (consultItem.total || 0) - totalRefunds);
          totalCollected += netRevenue;
          totalConsultations += 1;
        }
      }

      // If already generated for this period and doctor, skip or update draft
      const existing = await prisma.doctorPaymentStatement.findFirst({
        where: {
          doctorId: doc.id,
          periodStart: start,
          periodEnd: end,
        },
      });

      const commissionType = inputCommissionType || doc.commissionType || "PERCENTAGE";
      const commissionRate = inputCommissionRate !== undefined ? parseFloat(inputCommissionRate) : (doc.commissionRate ?? (commissionType === "FLAT" ? 500 : 15));
      let hospitalCommission = 0;
      if (commissionType === "FLAT") {
        hospitalCommission = Math.min(totalCollected, commissionRate * totalConsultations);
      } else {
        hospitalCommission = Math.round(totalCollected * (commissionRate / 100) * 100) / 100;
      }
      const netDoctorPayment = Math.max(0, Math.round((totalCollected - hospitalCommission) * 100) / 100);

      if (existing) {
        if (existing.status === "DRAFT") {
          const updated = await prisma.doctorPaymentStatement.update({
            where: { id: existing.id },
            data: {
              totalConsultations,
              totalRevenue: totalCollected,
              commissionRate,
              commissionType,
              hospitalCommission,
              netDoctorPayment,
            },
            include: { doctor: true },
          });
          createdStatements.push(updated);
        }
      } else {
        const statement = await prisma.doctorPaymentStatement.create({
          data: {
            doctorId: doc.id,
            periodStart: start,
            periodEnd: end,
            totalConsultations,
            totalRevenue: totalCollected,
            commissionRate,
            commissionType,
            hospitalCommission,
            netDoctorPayment,
            status: "DRAFT",
          },
          include: { doctor: true },
        });
        createdStatements.push(statement);
      }
    }

    // Audit log
    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "DoctorPaymentStatement",
          entityId: "BULK_GENERATE",
          action: "DOCTOR_STATEMENTS_GENERATED",
          description: `Generated ${createdStatements.length} doctor payment statements for period ${start.toISOString()} to ${end.toISOString()}`,
          userId: authUser.id,
        },
      }).catch(err => console.error(err));
    }

    res.json({ success: true, count: createdStatements.length, data: createdStatements });
  } catch (error: any) {
    console.error("Error generating doctor statements:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /api/finance/doctor-statements/:id/status
export const updateDoctorStatementStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status, paymentMethod, paymentReference, remarks } = req.body;
    const authUser = (req as any).user;

    const existing: any = await prisma.doctorPaymentStatement.findUnique({
      where: { id },
      include: { doctor: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Statement not found" });
    }

    const dataToUpdate: any = { status };
    if (remarks !== undefined) dataToUpdate.remarks = remarks;

    if (status === "APPROVED") {
      dataToUpdate.approvedBy = authUser?.id || null;
      dataToUpdate.approvedAt = new Date();
    } else if (status === "PAID") {
      dataToUpdate.paidAt = new Date();
      dataToUpdate.paymentMethod = paymentMethod || "BANK_TRANSFER";
      dataToUpdate.paymentReference = paymentReference || null;
    }

    const updated = await prisma.doctorPaymentStatement.update({
      where: { id },
      data: dataToUpdate,
      include: { doctor: true },
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "DoctorPaymentStatement",
          entityId: id,
          action: `DOCTOR_STATEMENT_${status}`,
          description: `Doctor statement for Dr. ${existing.doctor?.fullName || "Doctor"} marked as ${status}`,
          userId: authUser.id,
        },
      }).catch(err => console.error(err));
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("Error updating doctor statement status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
