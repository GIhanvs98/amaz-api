import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfDay = new Date(today); // Derive from today to avoid off-by-millisecond at midnight
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Total Appointments Today
    const totalAppointments = await prisma.appointment.count({
      where: {
        appointmentDate: { gte: today, lte: endOfDay }
      }
    });

    // 2. Doctor Attendance Status
    const doctorsAttendance = await prisma.doctorAttendance.findMany({
      where: {
        date: { gte: today, lte: endOfDay }
      },
      include: { doctor: { select: { fullName: true } } }
    });

    // 3. Pending Labs
    const pendingLabs = await prisma.labRequest.count({
      where: { status: "PENDING" }
    });

    // 4. Today's Revenue
    const payments = await prisma.payment.aggregate({
      where: {
        createdAt: { gte: today, lte: endOfDay },
        status: "COMPLETED"
      },
      _sum: { amount: true }
    });
    
    const todaysRevenue = payments._sum.amount || 0;

    res.json({
      success: true,
      data: {
        totalAppointments,
        doctorsAttendance: doctorsAttendance.map(a => ({
          name: a.doctor.fullName,
          status: a.status,
          arrivedAt: a.arrivedAt
        })),
        pendingLabs,
        todaysRevenue
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
