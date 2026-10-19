import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// Helper: Calculate OT hours handling overnight shifts
export function calculateOTHours(start: Date, end: Date): number {
  let diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    // Overnight shift: end is on next day
    diffMs += 24 * 60 * 60 * 1000;
  }
  const hours = diffMs / (1000 * 60 * 60);
  return Math.round(hours * 100) / 100;
}

// GET /api/hr/overtime
export const getOvertimeRecords = async (req: Request, res: Response) => {
  try {
    const { userId, status, shiftType, startDate, endDate, departmentId } = req.query;

    const where: any = {};
    if (userId) where.userId = String(userId);
    if (status) where.status = String(status);
    if (shiftType) where.shiftType = String(shiftType);
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(String(startDate));
      if (endDate) {
        const eDate = new Date(String(endDate));
        eDate.setHours(23, 59, 59, 999);
        where.date.lte = eDate;
      }
    }
    if (departmentId) {
      where.user = { departmentId: String(departmentId) };
    }

    const records = await prisma.overtimeRecord.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            Role: { select: { id: true, name: true } },
            Department: { select: { id: true, name: true } },
          },
        },
        approvedBy: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    res.json({ success: true, data: records });
  } catch (error: any) {
    console.error("Error fetching OT records:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/hr/overtime
export const createOvertimeRecord = async (req: Request, res: Response) => {
  try {
    const { userId, date, shiftType = "NORMAL", startTime, endTime, hours: directHours, rate: directRate, remarks } = req.body;

    if (!userId || !date) {
      return res.status(400).json({ success: false, error: "userId and date are required" });
    }

    // Determine hours
    let calculatedHours = 0;
    let sTime: Date | null = null;
    let eTime: Date | null = null;

    if (startTime && endTime) {
      sTime = new Date(startTime);
      eTime = new Date(endTime);
      calculatedHours = calculateOTHours(sTime, eTime);
    } else if (directHours !== undefined) {
      calculatedHours = parseFloat(directHours);
    } else {
      return res.status(400).json({ success: false, error: "Either (startTime and endTime) or hours must be provided" });
    }

    if (calculatedHours <= 0) {
      return res.status(400).json({ success: false, error: "Overtime hours must be greater than zero" });
    }

    // Determine rate if not directly passed
    let applicableRate = directRate ? parseFloat(directRate) : 0;
    if (!applicableRate || applicableRate <= 0) {
      // Lookup role template or employee profile
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { Role: true },
      });
      if (user?.Role?.name) {
        const template = await prisma.rolePayrollTemplate.findUnique({
          where: { role: user.Role.name },
        });
        applicableRate = template?.otRate || 0;
      }
    }

    if (applicableRate <= 0) {
      // Default fallback if not configured
      applicableRate = 500;
    }

    const totalPayment = Math.round(calculatedHours * applicableRate * 100) / 100;

    const record = await prisma.overtimeRecord.create({
      data: {
        userId,
        date: new Date(date),
        shiftType,
        startTime: sTime,
        endTime: eTime,
        hours: calculatedHours,
        rate: applicableRate,
        totalPayment,
        status: "PENDING",
        remarks: remarks || null,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } },
          },
        },
      },
    });

    res.status(201).json({ success: true, data: record });
  } catch (error: any) {
    console.error("Error creating OT record:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /api/hr/overtime/:id/status
export const updateOvertimeStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status, remarks } = req.body;
    const authUser = (req as any).user;

    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status. Allowed: APPROVED, REJECTED, PENDING" });
    }

    const existing: any = await prisma.overtimeRecord.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "OT record not found" });
    }

    const updated: any = await prisma.overtimeRecord.update({
      where: { id },
      data: {
        status,
        remarks: remarks !== undefined ? remarks : existing.remarks,
        approvedById: status === "APPROVED" ? authUser?.id || null : null,
        approvedAt: status === "APPROVED" ? new Date() : null,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });

    // Audit log
    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "OvertimeRecord",
          entityId: id,
          action: `OT_${status}`,
          description: `Overtime record for ${existing.user?.fullName || "Staff"} (${updated.hours} hrs, LKR ${updated.totalPayment}) was ${status.toLowerCase()} by user ${authUser.id}`,
          userId: authUser.id,
        },
      }).catch(err => console.error("Failed to write ActivityLog for OT:", err));
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("Error updating OT status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/hr/overtime/rates
export const getOvertimeRates = async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.rolePayrollTemplate.findMany({
      select: {
        id: true,
        role: true,
        otRate: true,
        perHourRate: true,
        workingHoursPerDay: true,
      },
    });
    res.json({ success: true, data: templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
