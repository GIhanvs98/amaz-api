import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import { clearCache } from "../middlewares/cache.middleware.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";

export const getAdminMetrics = async (req: Request, res: Response) => {
  try {
    const totalStaff = await prisma.user.count();
    
    // Count active doctors (anyone with specialty)
    const activeDoctors = await prisma.user.count({
      where: { specialty: { not: null }, isActive: true }
    });

    const activePatients = await prisma.patient.count();
    const { startOfDay } = getTimezoneBoundaries();

    const [payments, refunds] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: { in: ["COMPLETED", "REFUNDED"] } },
        _sum: { amount: true }
      }),
      prisma.refund.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amount: true }
      })
    ]);

    const grossRevenue = payments._sum.amount || 0;
    const totalRefunds = refunds._sum.amount || 0;
    const revenue = grossRevenue - totalRefunds;

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
      where: { isActive: true },
      include: { Role: true, Department: true },
      orderBy: { createdAt: 'desc' }
    });
    
    const formattedStaff = staff.map(s => ({
      id: s.id,
      name: s.fullName,
      email: s.email,
      role: s.Role.name,
      status: s.isActive ? "ACTIVE" : "INACTIVE",
      roomNumber: s.roomNumber,
      specialty: s.specialty,
      title: s.title,
      departmentId: s.departmentId,
      departmentName: s.Department?.name,
      consultationFee: s.consultationFee,
      feeType: s.feeType
    }));
    
    res.json({ data: formattedStaff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createStaff = async (req: Request, res: Response) => {
  try {
    const { name, email, password, roleName, specialty, roomNumber, title, departmentId, consultationFee, feeType } = req.body;
    
    if (!name || !email || !password || !roleName) {
      return res.status(400).json({ success: false, error: "Name, email, password, and roleName are required" });
    }

    // Find role
    let role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      return res.status(400).json({ success: false, error: "Role not found" });
    }

    if (departmentId && role.name.toUpperCase() !== 'DOCTOR') {
      return res.status(400).json({ success: false, error: "Only Doctors can be assigned to a department" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newStaff = await prisma.user.create({
      data: {
        fullName: name,
        email,
        password: hashedPassword,
        roleId: role.id,
        specialty: specialty || null,
        roomNumber: roomNumber || null,
        title: title || null,
        departmentId: departmentId || null,
        consultationFee: consultationFee ? parseFloat(consultationFee) : null,
        feeType: feeType || "POST"
      },
      include: { Role: true, Department: true }
    });

    await clearCache("/api/admin/staff");
    if (roleName.toUpperCase() === 'DOCTOR') {
      await clearCache("/api/admin/doctors");
      await clearCache("/api/reception/doctors");
      await clearCache("/api/booking/doctors");
      await clearCache("*departments*");
    }

    res.json({ success: true, data: newStaff });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, error: "User with this email already exists" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateStaff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, password, roleName, specialty, roomNumber, title, departmentId, consultationFee, feeType } = req.body;
    
    let roleId;
    let foundRoleName;
    if (roleName) {
      let role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        return res.status(400).json({ success: false, error: "Role not found" });
      }
      roleId = role.id;
      foundRoleName = role.name;
    } else if (departmentId !== undefined) {
       // if we are updating departmentId, we need to make sure the user is currently a doctor
       const existingUser = await prisma.user.findUnique({ where: { id: id as string }, include: { Role: true }});
       if (existingUser) foundRoleName = existingUser.Role.name;
    }

    if (departmentId && foundRoleName?.toUpperCase() !== 'DOCTOR') {
      return res.status(400).json({ success: false, error: "Only Doctors can be assigned to a department" });
    }

    const data: any = {};
    if (name) data.fullName = name;
    if (email) data.email = email;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(password, salt);
    }
    if (roleId) data.roleId = roleId;
    if (specialty !== undefined) data.specialty = specialty || null;
    if (roomNumber !== undefined) data.roomNumber = roomNumber || null;
    if (title !== undefined) data.title = title || null;
    if (departmentId !== undefined) data.departmentId = departmentId || null;
    if (consultationFee !== undefined) data.consultationFee = consultationFee ? parseFloat(consultationFee) : null;
    if (feeType !== undefined) data.feeType = feeType || "POST";

    const updatedStaff = await prisma.user.update({
      where: { id: id as string },
      data,
      include: { Role: true, Department: true }
    });

    await clearCache("/api/admin/staff");
    await clearCache("/api/admin/doctors");
    await clearCache("/api/reception/doctors");
    await clearCache("/api/booking/doctors");
    await clearCache("*departments*");

    res.json({ success: true, data: updatedStaff });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, error: "User with this email already exists" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteStaff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.user.update({ where: { id: id as string }, data: { isActive: false } });

    await clearCache("/api/admin/staff");
    await clearCache("/api/admin/doctors");
    await clearCache("/api/reception/doctors");
    await clearCache("/api/booking/doctors");
    await clearCache("*departments*");

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        RolePermission: {
          include: {
            Permission: true
          }
        }
      }
    });
    res.json({ success: true, data: roles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createRole = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const role = await prisma.role.create({
      data: {
        name: name.toUpperCase(),
        description
      }
    });
    await clearCache('*roles*');
    res.json({ success: true, data: role });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateRolePermissions = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body; // array of { action, resource }
    const userRole = (req as any).user?.role;

    const roleToUpdate = await prisma.role.findUnique({ where: { id: id as string } });
    if (!roleToUpdate) return res.status(404).json({ error: "Role not found" });

    if (roleToUpdate.name === 'SUPERADMIN' && userRole !== 'SUPERADMIN') {
       return res.status(403).json({ error: "Cannot modify SUPERADMIN role permissions" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { roleId: id as string }
      });

      for (const p of permissions) {
        let perm = await tx.permission.findFirst({
          where: { action: p.action, resource: p.resource }
        });
        if (!perm) {
          perm = await tx.permission.create({
            data: { action: p.action, resource: p.resource }
          });
        }
        await tx.rolePermission.create({
          data: {
            roleId: id as string,
            permissionId: perm.id
          }
        });
      }
    });

    await clearCache('*roles*');
    res.json({ success: true, message: "Permissions updated" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
