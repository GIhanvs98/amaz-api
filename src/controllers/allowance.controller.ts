import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// GET /api/hr/allowance-rules
export const getAllowanceRules = async (_req: Request, res: Response) => {
  try {
    const components = await prisma.salaryComponent.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { assignments: true },
        },
      },
    });
    res.json({ success: true, data: components });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/hr/allowance-rules
export const createAllowanceRule = async (req: Request, res: Response) => {
  try {
    const {
      name,
      code,
      category = "EARNING",
      type = "ALLOWANCE",
      calculationMethod = "FIXED",
      defaultAmount = 0,
      applicableRoles = "ALL",
      isTaxable = true,
      isEpfEligible = true,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, error: "Name and code are required" });
    }

    const component = await prisma.salaryComponent.create({
      data: {
        name,
        code: code.toUpperCase().trim(),
        category,
        type,
        calculationMethod,
        defaultAmount: parseFloat(defaultAmount) || 0,
        applicableRoles,
        isTaxable: Boolean(isTaxable),
        isEpfEligible: Boolean(isEpfEligible),
        isActive: true,
      },
    });

    res.status(201).json({ success: true, data: component });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ success: false, error: "An allowance rule with this code already exists" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// PUT /api/hr/allowance-rules/:id
export const updateAllowanceRule = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const {
      name,
      category,
      type,
      calculationMethod,
      defaultAmount,
      applicableRoles,
      isTaxable,
      isEpfEligible,
      isActive,
    } = req.body;

    const updated = await prisma.salaryComponent.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(type !== undefined && { type }),
        ...(calculationMethod !== undefined && { calculationMethod }),
        ...(defaultAmount !== undefined && { defaultAmount: parseFloat(defaultAmount) || 0 }),
        ...(applicableRoles !== undefined && { applicableRoles }),
        ...(isTaxable !== undefined && { isTaxable: Boolean(isTaxable) }),
        ...(isEpfEligible !== undefined && { isEpfEligible: Boolean(isEpfEligible) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE /api/hr/allowance-rules/:id
export const deleteAllowanceRule = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Soft delete or set isActive to false
    await prisma.salaryComponent.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, message: "Allowance rule deactivated" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
