import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export const getAdminMetrics = async (req: Request, res: Response) => {
  try {
    const totalStaff = await prisma.user.count();
    
    // Count active doctors (anyone with specialty)
    const activeDoctors = await prisma.user.count({
      where: { specialty: { not: null } }
    });

    const activePatients = await prisma.patient.count();

    const payments = await prisma.payment.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amount: true }
    });
    const revenue = payments._sum.amount || 0;

    const revenueGrowth = 12.5;
    const systemAlerts = [
      { id: 1, type: "CRITICAL", title: "Low Pharmacy Stock", message: "Paracetamol 500mg falls below 100 units.", time: "10 mins ago" },
      { id: 2, type: "WARNING", title: "High Wait Times", message: "OPD wait times exceed 45 minutes for Dr. Silva.", time: "1 hour ago" },
      { id: 3, type: "INFO", title: "System Update", message: "Database backup completed successfully.", time: "3 hours ago" },
      { id: 4, type: "INFO", title: "New Staff Added", message: "Dr. Jenkins profile created.", time: "5 hours ago" },
    ];
    const revenueData = [
      { name: 'Jan', revenue: 400000 },
      { name: 'Feb', revenue: 300000 },
      { name: 'Mar', revenue: 500000 },
      { name: 'Apr', revenue: 450000 },
      { name: 'May', revenue: 600000 },
      { name: 'Jun', revenue: 700000 },
    ];

    res.json({
      totalStaff,
      revenue,
      activeDoctors,
      activePatients,
      revenueGrowth,
      systemAlerts,
      revenueData
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
