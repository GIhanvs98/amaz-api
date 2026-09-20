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

export const getStaff = async (req: Request, res: Response) => {
  try {
    const staff = await prisma.user.findMany({
      include: { Role: true },
      orderBy: { createdAt: 'desc' }
    });
    
    const formattedStaff = staff.map(s => ({
      id: s.id,
      name: s.fullName,
      email: s.email,
      role: s.Role.name,
      status: "ACTIVE", // Mocked as active since there's no status field
      roomNumber: s.roomNumber,
      specialty: s.specialty
    }));
    
    res.json({ data: formattedStaff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createStaff = async (req: Request, res: Response) => {
  try {
    const { name, email, password, roleName, specialty, roomNumber } = req.body;
    
    // Find or create role
    let role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      role = await prisma.role.create({ data: { name: roleName } });
    }

    const newStaff = await prisma.user.create({
      data: {
        fullName: name,
        email,
        password, // In a real app, hash this
        roleId: role.id,
        specialty: specialty || null,
        roomNumber: roomNumber || null
      },
      include: { Role: true }
    });

    res.json({ success: true, data: newStaff });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateStaff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, password, roleName, specialty, roomNumber } = req.body;
    
    let roleId;
    if (roleName) {
      let role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        role = await prisma.role.create({ data: { name: roleName } });
      }
      roleId = role.id;
    }

    const data: any = {};
    if (name) data.fullName = name;
    if (email) data.email = email;
    if (password) data.password = password;
    if (roleId) data.roleId = roleId;
    if (specialty !== undefined) data.specialty = specialty || null;
    if (roomNumber !== undefined) data.roomNumber = roomNumber || null;

    const updatedStaff = await prisma.user.update({
      where: { id: id as string },
      data,
      include: { Role: true }
    });

    res.json({ success: true, data: updatedStaff });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteStaff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
