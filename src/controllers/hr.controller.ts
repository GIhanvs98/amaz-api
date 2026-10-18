import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { websocketService } from "../services/websocket.service.js";

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
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } }
          }
        }
      }
    });

    websocketService.broadcast("leave_request_created", leave);
    res.status(201).json({ success: true, data: leave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getLeaves = async (req: Request, res: Response) => {
  try {
    const { userId, status } = req.query;

    const where: any = {};
    if (userId && typeof userId === "string") {
      where.userId = userId;
    }
    if (status && typeof status === "string") {
      where.status = status;
    }

    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } }
          }
        },
        reviewer: {
          select: {
            id: true,
            fullName: true
          }
        }
      },
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
    const { status, rejectionReason } = req.body;
    const reviewerId = (req as any).user?.id || null;
    
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be APPROVED or REJECTED" });
    }

    if (status === 'REJECTED' && (!rejectionReason || !rejectionReason.trim())) {
      return res.status(400).json({ error: "Rejection reason is required when rejecting a leave request" });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? rejectionReason.trim() : null,
        reviewedAt: new Date(),
        reviewedById: reviewerId
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } }
          }
        },
        reviewer: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
    });

    websocketService.broadcast("leave_status_updated", updated);
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
      const activeGlobalComponents = await tx.salaryComponent.findMany({ where: { isActive: true } });
      const attendances = await tx.staffAttendance.findMany({
        where: { date: { gte: start, lte: end } }
      });
      const leaves = await tx.leaveRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }
      });

      // Retrieve ONLY APPROVED Overtime Records for this period
      const approvedOvertimes = await tx.overtimeRecord.findMany({
        where: {
          status: 'APPROVED',
          date: { gte: start, lte: end }
        }
      });

      for (const profile of profiles) {
        const template = roleTemplates.find(t => t.role === profile.user.Role.name);
        const workHours = template?.workingHoursPerDay || 8;
        const perHourRate = template?.perHourRate || 0;
        const allowedLeaves = template?.allowedLeavesPerMonth || 0;

        const myAttendance = attendances.filter(a => a.userId === profile.userId);
        const myApprovedOTs = approvedOvertimes.filter(o => o.userId === profile.userId);

        let basicSalary = 0;
        let totalOtPayment = 0;
        let totalAllowances = 0;
        let totalBonuses = 0;
        let totalEarnings = 0;
        let totalDeductions = 0;
        let totalEmployerCost = 0;
        let epfBase = 0;
        const lineItems: any[] = [];

        // 1. BASIC SALARY CALCULATION
        if (profile.salaryBasis === 'HOURLY') {
          let totalWorkedHours = 0;
          for (const a of myAttendance) {
            if ((a.status === 'PRESENT' || a.status === 'LATE') && a.checkIn && a.checkOut) {
              const hours = (a.checkOut.getTime() - a.checkIn.getTime()) / (1000 * 60 * 60);
              totalWorkedHours += Math.min(hours, workHours);
            }
          }
          basicSalary = Math.round(totalWorkedHours * perHourRate * 100) / 100;
          if (basicSalary > 0) {
            lineItems.push({
              category: "BASIC",
              description: `Hourly Base Wages (${totalWorkedHours.toFixed(1)} hrs @ LKR ${perHourRate})`,
              amount: basicSalary
            });
            totalEarnings += basicSalary;
            epfBase += basicSalary;
          }
        } else {
          // MONTHLY CALCULATION
          const fullBaseSalary = profile.compensations[0]?.baseSalary || profile.user.basicSalary || 0;
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

          basicSalary = fullBaseSalary > 0 ? Math.round(((fullBaseSalary / 30) * payableDays) * 100) / 100 : 0;
          if (basicSalary > 0) {
            lineItems.push({
              category: "BASIC",
              description: payableDays < 30 ? `Prorated Base Salary (${payableDays} days)` : "Monthly Basic Salary",
              amount: basicSalary
            });
            totalEarnings += basicSalary;
            epfBase += basicSalary;
          }

          // Loss of Pay (LOP) for unexcused absences
          const absentCount = myAttendance.filter(a => a.status === 'ABSENT').length;
          const unapprovedAbsences = Math.max(0, absentCount - allowedLeaves);
          if (unapprovedAbsences > 0 && fullBaseSalary > 0) {
            const lop = Math.round(((fullBaseSalary / 30) * unapprovedAbsences) * 100) / 100;
            lineItems.push({
              category: "DEDUCTION",
              description: `Loss of Pay (${unapprovedAbsences} days)`,
              amount: lop
            });
            totalDeductions += lop;
            epfBase = Math.max(0, epfBase - lop);
          }
        }

        // 2. APPROVED OVERTIME PAYMENTS
        for (const ot of myApprovedOTs) {
          totalOtPayment += ot.totalPayment;
          lineItems.push({
            category: "OVERTIME",
            description: `OT (${ot.shiftType}): ${ot.hours} hrs @ LKR ${ot.rate}/hr`,
            amount: ot.totalPayment
          });
        }
        totalEarnings += totalOtPayment;
 
        // 3. ALLOWANCES, BONUSES & DEDUCTIONS
        // Combines both:
        // A) Designation-based components (matching employee Role or 'ALL')
        // B) Specific employee-based assignments (direct assignments to this employee profile)
        const employeeRoleName = (profile.user?.Role?.name || "").toUpperCase();
        const componentsToApply = new Map<string, { component: any; value: number }>();

        // A) Apply Designation-based rules matching employee's role or 'ALL'
        for (const gc of activeGlobalComponents) {
          if (gc.type === "BASIC" || gc.type === "OVERTIME") continue;

          const applicableRoles = (gc.applicableRoles || "ALL")
            .split(",")
            .map(r => r.trim().toUpperCase());

          const isRoleApplicable = applicableRoles.includes("ALL") || applicableRoles.includes(employeeRoleName);

          if (isRoleApplicable) {
            componentsToApply.set(gc.id, {
              component: gc,
              value: gc.defaultAmount || 0
            });
          }
        }

        // B) Apply Employee-specific assignments (overrides default or adds specific component)
        for (const ec of profile.components) {
          if (!ec.component.isActive) continue;
          const assignedVal = (ec.value !== null && ec.value !== undefined) ? ec.value : (ec.component.defaultAmount || 0);
          componentsToApply.set(ec.componentId, {
            component: ec.component,
            value: assignedVal
          });
        }

        // C) Calculate line items
        for (const { component: comp, value } of componentsToApply.values()) {
          let calculatedVal = value;
          if (comp.calculationMethod === "PERCENTAGE") {
            calculatedVal = Math.round((basicSalary * (value / 100)) * 100) / 100;
          }

          if (calculatedVal <= 0) continue;

          const compType = (comp.type || "").toUpperCase();
          const compCat = (comp.category || "").toUpperCase();

          if (compType === "BONUS") {
            totalBonuses += calculatedVal;
            totalEarnings += calculatedVal;
            lineItems.push({ category: "BONUS", description: comp.name, amount: calculatedVal });
          } else if (compType === "ALLOWANCE" || compCat === "EARNING") {
            totalAllowances += calculatedVal;
            totalEarnings += calculatedVal;
            if (comp.isEpfEligible) epfBase += calculatedVal;
            lineItems.push({ category: "ALLOWANCE", description: comp.name, amount: calculatedVal });
          } else if (compType === "DEDUCTION" || compCat === "DEDUCTION") {
            totalDeductions += calculatedVal;
            lineItems.push({ category: "DEDUCTION", description: comp.name, amount: calculatedVal });
          } else if (compCat === "EMPLOYER_CONTRIBUTION") {
            totalEmployerCost += calculatedVal;
            lineItems.push({ category: "EMPLOYER_CONTRIBUTION", description: comp.name, amount: calculatedVal });
          }
        }

        // 4. STATUTORY CALCULATIONS (EPF 8% Employee, EPF 12% Employer, ETF 3% Employer)
        if (epfBase > 0) {
          const epf8 = Math.round((epfBase * 0.08) * 100) / 100;
          const epf12 = Math.round((epfBase * 0.12) * 100) / 100;
          const etf3 = Math.round((epfBase * 0.03) * 100) / 100;

          totalDeductions += epf8;
          totalEmployerCost += (epf12 + etf3);

          lineItems.push({
            category: "STATUTORY",
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

        // 5. NET SALARY: Net Salary = Basic + OT + Allowances + Bonuses - Deductions
        totalEarnings = Math.round(totalEarnings * 100) / 100;
        totalDeductions = Math.round(totalDeductions * 100) / 100;
        const netSalary = Math.round((totalEarnings - totalDeductions) * 100) / 100;

        await tx.payrollRecord.create({
          data: {
            payrollRunId: payrollRun.id,
            userId: profile.userId,
            basicSalary,
            totalOtPayment,
            totalAllowances,
            totalBonuses,
            totalEarnings,
            totalDeductions,
            employerCost: totalEmployerCost,
            netSalary,
            status: "DRAFT",
            paymentMethod: profile.paymentMethod || "BANK_TRANSFER",
            bankDetails: profile.bankDetails || undefined,
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

// PATCH /api/hr/payroll/:id/status
export const updatePayrollRunStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, paymentMethod, paymentReference, remarks } = req.body;
    const authUser = (req as any).user;

    const allowedStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID", "CANCELLED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` });
    }

    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { records: true },
    });
    if (!run) return res.status(404).json({ success: false, error: "Payroll run not found" });

    // Transition validation
    if (run.status === "PAID" && status !== "PAID") {
      return res.status(400).json({ success: false, error: "A paid payroll run cannot be reverted." });
    }
    if (run.status === "CANCELLED") {
      return res.status(400).json({ success: false, error: "A cancelled payroll run cannot be updated." });
    }

    const dataToUpdate: any = {
      status,
      remarks: remarks !== undefined ? remarks : run.remarks,
    };

    if (status === "APPROVED") {
      dataToUpdate.approvedBy = authUser?.id || "ADMIN";
      dataToUpdate.approvedAt = new Date();
    } else if (status === "PAID") {
      dataToUpdate.paidAt = new Date();
      dataToUpdate.paymentMethod = paymentMethod || "BANK_TRANSFER";
      dataToUpdate.paymentReference = paymentReference || `PAY-${Date.now()}`;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedRun = await tx.payrollRun.update({
        where: { id },
        data: dataToUpdate,
      });

      // Synchronize employee record statuses unless record is ON_HOLD
      if (["APPROVED", "PROCESSING", "PAID", "CANCELLED"].includes(status)) {
        await tx.payrollRecord.updateMany({
          where: {
            payrollRunId: id,
            status: { not: "ON_HOLD" },
          },
          data: {
            status,
            ...(status === "PAID" && {
              paidAt: new Date(),
              paymentMethod: paymentMethod || "BANK_TRANSFER",
              paymentReference: paymentReference || `PAY-${Date.now()}`,
            }),
          },
        });
      }

      return updatedRun;
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "PayrollRun",
          entityId: id,
          action: `PAYROLL_${status}`,
          description: `Payroll run (${run.periodStart.toISOString()} - ${run.periodEnd.toISOString()}) transitioned to ${status}`,
          userId: authUser.id,
        },
      }).catch(err => console.error(err));
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("Error updating payroll run status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /api/hr/payroll/records/:recordId/status
export const updatePayrollRecordStatus = async (req: Request, res: Response) => {
  try {
    const recordId = req.params.recordId as string;
    const { status, remarks } = req.body;
    const authUser = (req as any).user;

    const allowedRecordStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID", "ON_HOLD", "CANCELLED"];
    if (!allowedRecordStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Allowed: ${allowedRecordStatuses.join(", ")}` });
    }

    const record = await prisma.payrollRecord.update({
      where: { id: recordId },
      data: { status },
      include: { user: true },
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "PayrollRecord",
          entityId: recordId,
          action: `PAYROLL_RECORD_${status}`,
          description: `Salary record for ${record.user.fullName} set to ${status}. ${remarks || ""}`,
          userId: authUser.id,
        },
      }).catch(err => console.error(err));
    }

    res.json({ success: true, data: record });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/hr/my-payslips (for self-service staff)
export const getMyPayslips = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser?.id) return res.status(401).json({ success: false, error: "Unauthorized" });

    const records = await prisma.payrollRecord.findMany({
      where: {
        userId: authUser.id,
        status: { in: ["APPROVED", "PROCESSING", "PAID"] }, // Don't expose Drafts to regular staff
      },
      include: {
        run: true,
        lineItems: true,
        user: {
          select: {
            id: true,
            fullName: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } },
          },
        },
      },
      orderBy: { netSalary: "desc" },
    });

    res.json({ success: true, data: records });
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

    // Return 200 with data: null so frontend knows profile is empty instead of erroring
    if (!profile) {
      return res.status(200).json({ success: true, data: null });
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: "Staff user not found" });
    }

    const existingProfile = await prisma.employeeProfile.findUnique({ where: { userId } });

    const safeJoiningDate = joiningDate && !isNaN(new Date(joiningDate).getTime())
      ? new Date(joiningDate)
      : (existingProfile?.joiningDate || new Date());

    const safeEmploymentType = employmentType || existingProfile?.employmentType || "FULL_TIME";
    const safeSalaryBasis = salaryBasis || existingProfile?.salaryBasis || "MONTHLY";
    const safePaymentMethod = paymentMethod || existingProfile?.paymentMethod || "BANK_TRANSFER";

    // Start a transaction since we are touching profile and compensations
    const result = await prisma.$transaction(async (tx) => {
      // 1. Upsert Profile
      const profile = await tx.employeeProfile.upsert({
        where: { userId },
        update: {
          employmentType: safeEmploymentType,
          salaryBasis: safeSalaryBasis,
          joiningDate: safeJoiningDate,
          terminationDate: terminationDate && !isNaN(new Date(terminationDate).getTime()) ? new Date(terminationDate) : null,
          paymentMethod: safePaymentMethod,
          bankDetails: bankDetails !== undefined ? bankDetails : undefined,
        },
        create: {
          userId,
          employmentType: safeEmploymentType,
          salaryBasis: safeSalaryBasis,
          joiningDate: safeJoiningDate,
          terminationDate: terminationDate && !isNaN(new Date(terminationDate).getTime()) ? new Date(terminationDate) : null,
          paymentMethod: safePaymentMethod,
          bankDetails: bankDetails || null,
        }
      });

      // 2. Handle Base Salary if provided
      if (baseSalary !== undefined && baseSalary !== null && !isNaN(Number(baseSalary))) {
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
    console.error("updatePayrollProfile error:", error);
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

    // Find or create profile if not yet created
    let profile = await prisma.employeeProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.employeeProfile.create({
        data: {
          userId,
          employmentType: "FULL_TIME",
          salaryBasis: "MONTHLY",
          joiningDate: new Date(),
          paymentMethod: "BANK_TRANSFER"
        }
      });
    }

    const safeEffectiveFrom = effectiveFrom && !isNaN(new Date(effectiveFrom).getTime())
      ? new Date(effectiveFrom)
      : new Date();

    const numericValue = (value !== undefined && value !== null && value !== "")
      ? Number(value)
      : null;

    // Check if an assignment already exists for this component
    const existing = await prisma.employeeComponent.findFirst({
      where: {
        employeeProfileId: profile.id,
        componentId,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }]
      }
    });

    let assignment;
    if (existing) {
      assignment = await prisma.employeeComponent.update({
        where: { id: existing.id },
        data: {
          value: numericValue,
          effectiveFrom: safeEffectiveFrom,
          effectiveTo: null,
        },
        include: { component: true }
      });
    } else {
      assignment = await prisma.employeeComponent.create({
        data: {
          employeeProfileId: profile.id,
          componentId,
          value: numericValue,
          effectiveFrom: safeEffectiveFrom
        },
        include: { component: true }
      });
    }
    
    res.status(201).json({ success: true, data: assignment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const removeEmployeeComponent = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.params.userId as string | undefined;

    try {
      await prisma.employeeComponent.delete({
        where: { id }
      });
      return res.json({ success: true, message: "Component assignment removed" });
    } catch {
      if (userId) {
        const profile = await prisma.employeeProfile.findUnique({ where: { userId } });
        if (profile) {
          await prisma.employeeComponent.deleteMany({
            where: {
              employeeProfileId: profile.id,
              componentId: id
            }
          });
          return res.json({ success: true, message: "Component assignment removed" });
        }
      }
      return res.status(404).json({ success: false, error: "Component assignment not found" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
