import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // --- SUMMARY CARDS ---
    
    // Patients
    const totalPatients = await prisma.patient.count();
    const newPatientsToday = await prisma.patient.count({
      where: { createdAt: { gte: today, lte: endOfDay } }
    });

    // Appointments
    const totalAppointments = await prisma.appointment.count({
      where: { appointmentDate: { gte: today, lte: endOfDay } }
    });
    const appointmentsYesterday = await prisma.appointment.count({
      where: { appointmentDate: { gte: yesterday, lte: endOfYesterday } }
    });

    // Revenue
    const todaysPayments = await prisma.payment.aggregate({
      where: { createdAt: { gte: today, lte: endOfDay }, status: "COMPLETED" },
      _sum: { amount: true }
    });
    const todaysRevenue = todaysPayments._sum.amount || 0;

    const yesterdaysPayments = await prisma.payment.aggregate({
      where: { createdAt: { gte: yesterday, lte: endOfYesterday }, status: "COMPLETED" },
      _sum: { amount: true }
    });
    const yesterdaysRevenue = yesterdaysPayments._sum.amount || 0;

    // Labs
    const pendingLabs = await prisma.labRequest.count({
      where: { status: "PENDING" }
    });

    // Doctors
    const activeDoctorsCount = await prisma.doctorAttendance.count({
      where: { date: { gte: today, lte: endOfDay }, status: { in: ["ARRIVED", "IN_CONSULTATION"] } }
    });

    // --- CHARTS DATA ---
    
    // Revenue trend (last 7 days)
    // We group by day manually to avoid complex DB dialects
    const recentPayments = await prisma.payment.findMany({
      where: { createdAt: { gte: sevenDaysAgo, lte: endOfDay }, status: "COMPLETED" },
      select: { createdAt: true, amount: true }
    });

    const revenueByDayMap = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateString = d.toISOString().split('T')[0];
      revenueByDayMap.set(dateString, 0);
    }

    recentPayments.forEach(p => {
      const dateString = p.createdAt.toISOString().split('T')[0];
      if (revenueByDayMap.has(dateString)) {
        revenueByDayMap.set(dateString, revenueByDayMap.get(dateString) + p.amount);
      }
    });

    const revenueTrend = Array.from(revenueByDayMap.entries()).map(([date, revenue]) => ({
      date,
      revenue
    }));

    // Department Stats (Appointments today)
    const todaysAppointments = await prisma.appointment.findMany({
      where: { appointmentDate: { gte: today, lte: endOfDay } },
      select: { department: true }
    });
    
    const deptCount = todaysAppointments.reduce((acc: any, appt) => {
      acc[appt.department] = (acc[appt.department] || 0) + 1;
      return acc;
    }, {});
    
    const departmentStats = Object.entries(deptCount).map(([name, value]) => ({ name, value }));

    // --- TABLES DATA ---

    // Inventory Alerts (Medicines low on stock)
    const medicines = await prisma.medicine.findMany({
      where: { isActive: true },
      include: { stockBatches: true }
    });

    const inventoryAlerts = medicines
      .map(med => {
        const totalStock = med.stockBatches.reduce((sum, batch) => sum + batch.currentQuantity, 0);
        return {
          id: med.id,
          name: med.name,
          category: med.category,
          currentStock: totalStock,
          reorderLevel: med.reorderLevel,
          unit: med.unit
        };
      })
      .filter(med => med.currentStock <= med.reorderLevel)
      .slice(0, 10); // Take top 10 most critical

    // Recent Transactions
    const recentTransactions = await prisma.payment.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        invoice: {
          include: {
            lineItems: { take: 1, select: { description: true } }
          }
        }
      }
    });

    const formattedTransactions = recentTransactions.map(t => ({
      id: t.id,
      amount: t.amount,
      method: t.method,
      description: t.invoice.lineItems[0]?.description || "Payment",
      time: t.createdAt
    }));

    // Doctor Attendance
    const doctorsAttendance = await prisma.doctorAttendance.findMany({
      where: { date: { gte: today, lte: endOfDay } },
      include: { doctor: { select: { fullName: true, specialty: true } } }
    });

    // Top Extra Services (from InvoiceLineItem where referenceId might link to extra services)
    // For simplicity, we can fetch active extra services count or recent
    const activeExtraServices = await prisma.extraService.count({
      where: { isActive: true }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalPatients,
          newPatientsToday,
          totalAppointments,
          appointmentsYesterday,
          todaysRevenue,
          yesterdaysRevenue,
          pendingLabs,
          activeDoctorsCount,
          activeExtraServices
        },
        charts: {
          revenueTrend,
          departmentStats
        },
        tables: {
          inventoryAlerts,
          recentTransactions: formattedTransactions,
          doctorsAttendance: doctorsAttendance.map(a => ({
            name: a.doctor.fullName,
            specialty: a.doctor.specialty || "General",
            status: a.status,
            arrivedAt: a.arrivedAt
          }))
        }
      }
    });
  } catch (error: any) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
