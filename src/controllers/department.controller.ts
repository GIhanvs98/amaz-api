import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class DepartmentController {
  /**
   * Get all departments with their assigned doctors
   */
  async getDepartments(req: Request, res: Response) {
    try {
      const departments = await prisma.department.findMany({
        include: {
          Users: {
            select: {
              id: true,
              fullName: true,
              specialty: true,
              consultationFee: true,
              feeType: true
            }
          },
          _count: {
            select: { Users: true }
          }
        },
        orderBy: { name: 'asc' }
      });
      res.json(departments);
    } catch (error: any) {
      console.error("Get Departments Error:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  }

  /**
   * Get all doctors to assign
   */
  async getAvailableDoctors(req: Request, res: Response) {
    try {
      const doctors = await prisma.user.findMany({
        where: {
          Role: {
            name: 'DOCTOR' // Assuming role name is DOCTOR
          }
        },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          consultationFee: true,
          feeType: true,
          departmentId: true
        }
      });
      res.json(doctors);
    } catch (error: any) {
      console.error("Get Doctors Error:", error);
      res.status(500).json({ error: "Failed to fetch doctors" });
    }
  }

  /**
   * Create a new department
   */
  async createDepartment(req: Request, res: Response) {
    try {
      const { name, description, isActive } = req.body;
      
      const existing = await prisma.department.findUnique({
        where: { name }
      });

      if (existing) {
        return res.status(400).json({ error: "Department with this name already exists" });
      }

      const department = await prisma.department.create({
        data: {
          name,
          description,
          isActive: isActive !== undefined ? isActive : true
        },
        include: {
          _count: { select: { Users: true } }
        }
      });
      
      res.status(201).json(department);
    } catch (error: any) {
      console.error("Create Department Error:", error);
      res.status(500).json({ error: "Failed to create department" });
    }
  }

  /**
   * Update a department
   */
  async updateDepartment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, description, isActive } = req.body;

      const department = await prisma.department.update({
        where: { id: id as string },
        data: { name, description, isActive },
        include: {
          Users: {
            select: {
              id: true,
              fullName: true,
              specialty: true,
              consultationFee: true,
              feeType: true
            }
          },
          _count: { select: { Users: true } }
        }
      });

      res.json(department);
    } catch (error: any) {
      console.error("Update Department Error:", error);
      res.status(500).json({ error: "Failed to update department" });
    }
  }

  /**
   * Delete a department
   */
  async deleteDepartment(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Check if doctors are assigned
      const dept = await prisma.department.findUnique({
        where: { id: id as string },
        include: { _count: { select: { Users: true } } }
      });

      if (dept && (dept as any)._count.Users > 0) {
        return res.status(400).json({ error: "Cannot delete department with assigned doctors. Reassign them first." });
      }

      await prisma.department.delete({ where: { id: id as string } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete Department Error:", error);
      res.status(500).json({ error: "Failed to delete department" });
    }
  }

  /**
   * Assign or Update Doctor in Department (and set Fee)
   */
  async updateDoctorAssignment(req: Request, res: Response) {
    try {
      const { doctorId } = req.params;
      const { departmentId, consultationFee, feeType } = req.body;

      const user = await prisma.user.update({
        where: { id: doctorId as string },
        data: {
          ...(departmentId !== undefined && { departmentId: departmentId || null }),
          ...(consultationFee !== undefined && { consultationFee }),
          ...(feeType !== undefined && { feeType })
        }
      });

      res.json(user);
    } catch (error: any) {
      console.error("Update Doctor Assignment Error:", error);
      res.status(500).json({ error: "Failed to update doctor assignment" });
    }
  }
}

export const departmentController = new DepartmentController();
