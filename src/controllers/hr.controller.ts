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
    const { periodStart, periodEnd } = req.body;
    
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Prevent duplicate run
    const existing = await prisma.payrollRun.findFirst({
      where: { periodStart: start, periodEnd: end }
    });
    if (existing) return res.status(400).json({ success: false, error: "Payroll run already exists for this period." });

    const run = await prisma.$transaction(async (tx) => {
      const payrollRun = await tx.payrollRun.create({
        data: {
          periodStart: start,
          periodEnd: end,
          payDate: end,
          type: "MONTHLY",
          status: "DRAFT"
        }
      });

      // Get all active profiles with active base salary and components
      const profiles = await tx.employeeProfile.findMany({
        where: {
          OR: [{ terminationDate: null }, { terminationDate: { gt: start } }]
        },
        include: {
          user: { include: { Role: true } },
          compensations: { where: { isActive: true }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
          components: { 
            where: { OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }] },
            include: { component: true }
          }
        }
      });

      const roleTemplates = await tx.rolePayrollTemplate.findMany();
      const attendances = await tx.staffAttendance.findMany({
        where: { date: { gte: start, lte: end } }
      });
      const leaves = await tx.leaveRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }
      });

      for (const profile of profiles) {
        const template = roleTemplates.find(t => t.role === profile.user.Role.name);
        const workHours = template?.workingHoursPerDay || 8;
        const otRate = template?.otRate || 0;
        const perHourRate = template?.perHourRate || 0;
        const allowedLeaves = template?.allowedLeavesPerMonth || 0;

        const myAttendance = attendances.filter(a => a.userId === profile.userId);
        
        let totalEarnings = 0;
        let totalDeductions = 0;
        let totalEmployerCost = 0;
        let epfBase = 0;
        const lineItems = [];

        if (profile.salaryBasis === 'HOURLY') {
          // HOURLY CALCULATION
          let totalWorkedHours = 0;
          let totalOTHours = 0;
          
          for (const a of myAttendance) {
            if ((a.status === 'PRESENT' || a.status === 'LATE') && a.checkIn && a.checkOut) {
              const hours = (a.checkOut.getTime() - a.checkIn.getTime()) / (1000 * 60 * 60);
              if (hours > workHours) {
                totalWorkedHours += workHours;
                totalOTHours += (hours - workHours);
              } else {
                totalWorkedHours += hours;
              }
            }
          }

          const baseWages = totalWorkedHours * perHourRate;
          if (baseWages > 0) {
            lineItems.push({ category: "BASIC", description: `Hourly Wages (${totalWorkedHours.toFixed(1)} hrs)`, amount: baseWages });
            totalEarnings += baseWages;
            epfBase += baseWages;
          }

          const otWages = totalOTHours * otRate;
          if (otWages > 0) {
            lineItems.push({ category: "EARNING", description: `Overtime Pay (${totalOTHours.toFixed(1)} hrs)`, amount: otWages });
            totalEarnings += otWages;
            epfBase += otWages;
          }
        } else {
          // MONTHLY CALCULATION
          const fullBaseSalary = profile.compensations[0]?.baseSalary || 0;
          let payableDays = 30; 
          const joinDate = new Date(profile.joiningDate);
          const termDate = profile.terminationDate ? new Date(profile.terminationDate) : null;
          
          if (joinDate > start && joinDate <= end) {
            payableDays = 30 - joinDate.getDate() + 1;
          }
          if (termDate && termDate >= start && termDate <= end) {
            payableDays = termDate.getDate();
          }
          payableDays = Math.min(30, Math.max(0, payableDays));
          
          const baseSalary = fullBaseSalary > 0 ? (fullBaseSalary / 30) * payableDays : 0;
          if (baseSalary > 0) {
            lineItems.push({ category: "BASIC", description: payableDays < 30 ? `Prorated Base Salary (${payableDays} days)` : "Monthly Base Salary", amount: baseSalary });
            totalEarnings += baseSalary;
            epfBase += baseSalary;
          }

          // LOP (Loss of Pay)
          const absentCount = myAttendance.filter(a => a.status === 'ABSENT').length;
          const unapprovedAbsences = Math.max(0, absentCount - allowedLeaves);
          if (unapprovedAbsences > 0) {
            const lop = (fullBaseSalary / 30) * unapprovedAbsences;
            lineItems.push({ category: "DEDUCTION", description: `Loss of Pay (${unapprovedAbsences} days)`, amount: lop });
            totalDeductions += lop;
            epfBase -= lop;
          }

          // OT Calculation
          let totalOTHours = 0;
          for (const a of myAttendance) {
            if ((a.status === 'PRESENT' || a.status === 'LATE') && a.checkIn && a.checkOut) {
              const hours = (a.checkOut.getTime() - a.checkIn.getTime()) / (1000 * 60 * 60);
              if (hours > workHours) totalOTHours += (hours - workHours);
            }
          }
          const otWages = totalOTHours * otRate;
          if (otWages > 0) {
            lineItems.push({ category: "EARNING", description: `Overtime Pay (${totalOTHours.toFixed(1)} hrs)`, amount: otWages });
            totalEarnings += otWages;
            epfBase += otWages;
          }
        }

        // Add static custom components
        for (const ec of profile.components) {
          const val = ec.value || 0; 
          let calculatedVal = val;
          
          if (ec.component.calculationMethod === "PERCENTAGE") {
            // Percentages base off basic salary
            const baseForPerc = profile.salaryBasis === 'HOURLY' ? 0 : (profile.compensations[0]?.baseSalary || 0);
            calculatedVal = baseForPerc * (val / 100);
          }

          if (ec.component.category === "EARNING") {
            totalEarnings += calculatedVal;
            if (ec.component.isEpfEligible) epfBase += calculatedVal;
          } else if (ec.component.category === "DEDUCTION") {
            totalDeductions += calculatedVal;
          } else if (ec.component.category === "EMPLOYER_CONTRIBUTION") {
            totalEmployerCost += calculatedVal;
          }

          lineItems.push({
            category: ec.component.category,
            description: ec.component.name,
            amount: calculatedVal
          });
        }

        // Statutory Calculations (EPF 8%, Employer EPF 12%, ETF 3%)
        if (epfBase > 0) {
          const epf8 = epfBase * 0.08;
          const epf12 = epfBase * 0.12;
          const etf3 = epfBase * 0.03;

          totalDeductions += epf8;
          totalEmployerCost += (epf12 + etf3);

          lineItems.push({
            category: "DEDUCTION",
            description: "Employee EPF (8%)",
            amount: epf8,
            isStatutory: true
          });
          lineItems.push({
            category: "EMPLOYER_CONTRIBUTION",
            description: "Employer EPF (12%)",
            amount: epf12,
            isStatutory: true
          });
          lineItems.push({
            category: "EMPLOYER_CONTRIBUTION",
            description: "Employer ETF (3%)",
            amount: etf3,
            isStatutory: true
          });
        }

        const netSalary = totalEarnings - totalDeductions;

        await tx.payrollRecord.create({
          data: {
            payrollRunId: payrollRun.id,
            userId: profile.userId,
            totalEarnings,
            totalDeductions,
            employerCost: totalEmployerCost,
            netSalary,
            status: "DRAFT",
            lineItems: {
              create: lineItems.map(item => ({
                category: item.category,
                description: item.description,
                amount: item.amount,
                isStatutory: item.isStatutory || false
              }))
            }
          }
        });
      }

      return payrollRun;
    });

    res.status(201).json({ success: true, data: run });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPayroll = async (req: Request, res: Response) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: { periodStart: 'desc' },
      include: {
        _count: { select: { records: true } }
      }
    });
    res.json({ success: true, data: runs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPayrollRunById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        records: {
          include: {
            user: true,
            lineItems: true
          }
        }
      }
    });
    if (!run) return res.status(404).json({ success: false, error: "Run not found" });
    res.json({ success: true, data: run });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPayrollProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId },
      include: {
        compensations: {
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        },
        components: {
          where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
          include: { component: true }
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: "Payroll profile not found" });
    }

    res.json({ success: true, data: profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updatePayrollProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const { employmentType, salaryBasis, joiningDate, terminationDate, paymentMethod, bankDetails, baseSalary } = req.body;

    // Start a transaction since we are touching profile and compensations
    const result = await prisma.$transaction(async (tx) => {
      // 1. Upsert Profile
      const profile = await tx.employeeProfile.upsert({
        where: { userId },
        update: {
          employmentType,
          salaryBasis,
          joiningDate: new Date(joiningDate),
          terminationDate: terminationDate ? new Date(terminationDate) : null,
          paymentMethod,
          bankDetails: bankDetails || null,
        },
        create: {
          userId,
          employmentType,
          salaryBasis,
          joiningDate: new Date(joiningDate),
          terminationDate: terminationDate ? new Date(terminationDate) : null,
          paymentMethod,
          bankDetails: bankDetails || null,
        }
      });

      // 2. Handle Base Salary if provided
      if (baseSalary !== undefined) {
        // Check current active
        const currentComp = await tx.compensationVersion.findFirst({
          where: { employeeProfileId: profile.id, isActive: true },
          orderBy: { effectiveFrom: 'desc' }
        });

        if (!currentComp || currentComp.baseSalary !== Number(baseSalary)) {
          // Deactivate old one
          if (currentComp) {
            await tx.compensationVersion.update({
              where: { id: currentComp.id },
              data: { isActive: false, effectiveTo: new Date() }
            });
          }
          // Create new one
          await tx.compensationVersion.create({
            data: {
              employeeProfileId: profile.id,
              baseSalary: Number(baseSalary),
              effectiveFrom: new Date(),
              isActive: true
            }
          });
        }
      }

      return tx.employeeProfile.findUnique({
        where: { userId },
        include: {
          compensations: { where: { isActive: true }, take: 1 }
        }
      });
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getSalaryComponents = async (req: Request, res: Response) => {
  try {
    const components = await prisma.salaryComponent.findMany({
      orderBy: { category: 'asc' }
    });
    res.json({ success: true, data: components });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createSalaryComponent = async (req: Request, res: Response) => {
  try {
    const { code, name, category, calculationMethod, isTaxable, isEpfEligible } = req.body;
    
    const component = await prisma.salaryComponent.create({
      data: {
        code,
        name,
        category,
        calculationMethod,
        isTaxable,
        isEpfEligible
      }
    });
    res.status(201).json({ success: true, data: component });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const assignEmployeeComponent = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const { componentId, value, effectiveFrom } = req.body;

    const profile = await prisma.employeeProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, error: "Profile not found" });

    const assignment = await prisma.employeeComponent.create({
      data: {
        employeeProfileId: profile.id,
        componentId,
        value: value !== undefined ? Number(value) : null,
        effectiveFrom: new Date(effectiveFrom)
      },
      include: { component: true }
    });
    
    res.status(201).json({ success: true, data: assignment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const removeEmployeeComponent = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const assignment = await prisma.employeeComponent.update({
      where: { id },
      data: { effectiveTo: new Date() } // Soft delete/end effectivity
    });
    
    res.json({ success: true, data: assignment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
