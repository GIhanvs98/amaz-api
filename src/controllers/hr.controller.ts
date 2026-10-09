import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// === ATTENDANCE ===

export const clockIn = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body; // or req.user.id if using auth middleware
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let attendance = await prisma.staffAttendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today
        }
      }
    });

    if (attendance) {
      return res.status(400).json({ error: "Already clocked in today" });
    }

    attendance = await prisma.staffAttendance.create({
      data: {
        userId,
        date: today,
        checkIn: new Date(),
        status: "PRESENT"
      }
    });

    res.status(201).json({ success: true, data: attendance });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const clockOut = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await prisma.staffAttendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today
        }
      }
    });

    if (!attendance) {
      return res.status(400).json({ error: "Not clocked in today" });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ error: "Already clocked out" });
    }

    const updated = await prisma.staffAttendance.update({
      where: { id: attendance.id },
      data: { checkOut: new Date() }
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getAttendance = async (req: Request, res: Response) => {
  try {
    const records = await prisma.staffAttendance.findMany({
      include: { user: { select: { id: true, fullName: true, email: true, Role: { select: { name: true } } } } },
      orderBy: [{ date: 'desc' }, { checkIn: 'desc' }]
    });
    res.json({ success: true, data: records });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// === LEAVE MANAGEMENT ===

export const applyLeave = async (req: Request, res: Response) => {
  try {
    const { userId, type, startDate, endDate, reason } = req.body;
    if (!userId || !type || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        userId,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason
      }
    });

    res.status(201).json({ success: true, data: leave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getLeaves = async (req: Request, res: Response) => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      include: { user: { select: { id: true, fullName: true, Role: { select: { name: true } } } } },
      orderBy: { appliedAt: 'desc' }
    });
    res.json({ success: true, data: leaves });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateLeaveStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status }
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// === PAYROLL ===

export const generatePayroll = async (req: Request, res: Response) => {
  try {
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ error: "Month and year required" });

    const staffList = await prisma.user.findMany({ where: { isActive: true } });
    
    const results = [];
    for (const staff of staffList) {
      const basicSalary = staff.basicSalary || 0;
      
      // Calculate absences for the given month/year
      // 1. Get total days in month
      const daysInMonth = new Date(year, month, 0).getDate();
      
      // 2. Count actual attendances
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      
      const attendanceCount = await prisma.staffAttendance.count({
        where: {
          userId: staff.id,
          date: { gte: startDate, lte: endDate },
          status: "PRESENT"
        }
      });

      // Simple calculation: deduction = (basic / daysInMonth) * (daysInMonth - attendanceCount)
      // This is a naive calculation, in reality we'd account for weekends, holidays, approved leaves.
      // We'll keep it simple for this prototype.
      const dailyRate = basicSalary / daysInMonth;
      const missedDays = Math.max(0, daysInMonth - attendanceCount - 8); // Assume 8 weekend days
      const deductions = missedDays > 0 ? missedDays * dailyRate : 0;
      const netSalary = basicSalary - deductions;

      const payroll = await prisma.payroll.upsert({
        where: {
          userId_month_year: { userId: staff.id, month, year }
        },
        update: {
          basicSalary,
          deductions,
          netSalary
        },
        create: {
          userId: staff.id,
          month,
          year,
          basicSalary,
          deductions,
          netSalary
        }
      });
      results.push(payroll);
    }

    res.status(201).json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getPayroll = async (req: Request, res: Response) => {
  try {
    const payrolls = await prisma.payroll.findMany({
      include: { user: { select: { id: true, fullName: true, Role: { select: { name: true } } } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });
    res.json({ success: true, data: payrolls });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
