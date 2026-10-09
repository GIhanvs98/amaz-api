import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export const getStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const staff = await prisma.user.findMany({
      include: {
        Role: true,
        Department: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: staff });
  } catch (error: any) {
    console.error("Error fetching staff:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, password, roleId, departmentId, specialty, title, roomNumber, consultationFee, feeType, isActive } = req.body;
    
    if (!email || !password || !roleId) {
      res.status(400).json({ success: false, error: "Email, password, and role are required" });
      return;
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      res.status(400).json({ success: false, error: "Email already in use" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        roleId,
        departmentId: departmentId || null,
        specialty: specialty || null,
        title: title || null,
        roomNumber: roomNumber || null,
        consultationFee: consultationFee ? parseFloat(consultationFee) : null,
        feeType: feeType || null,
        isActive: isActive !== undefined ? isActive : true
      },
      include: { Role: true, Department: true }
    });

    res.status(201).json({ success: true, data: newUser });
  } catch (error: any) {
    console.error("Error creating staff:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { fullName, email, password, roleId, departmentId, specialty, title, roomNumber, consultationFee, feeType, isActive } = req.body;

    const dataToUpdate: any = {
      fullName,
      email,
      roleId,
      departmentId: departmentId || null,
      specialty: specialty || null,
      title: title || null,
      roomNumber: roomNumber || null,
      consultationFee: consultationFee ? parseFloat(consultationFee) : null,
      feeType: feeType || null,
      isActive
    };

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      dataToUpdate.password = await bcrypt.hash(password, salt);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      include: { Role: true, Department: true }
    });

    res.status(200).json({ success: true, data: updatedUser });
  } catch (error: any) {
    console.error("Error updating staff:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.user.update({
      where: { id },
      data: { isActive: false } // Soft delete
    });
    res.status(200).json({ success: true, message: "Staff deactivated successfully" });
  } catch (error: any) {
    console.error("Error deleting staff:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
