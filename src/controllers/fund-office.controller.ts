import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// Helper to format date boundaries in local time
function getDayRange(dateStr: string) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

// Helper to generate unique receipt number: DOC-RCP-YYYYMM-XXXX
async function generateReceiptNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `DOC-RCP-${yearMonth}-`;
  
  const lastSheet = await prisma.doctorDailySheet.findFirst({
    where: { receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: "desc" },
    select: { receiptNumber: true }
  });

  let nextNum = 1;
  if (lastSheet?.receiptNumber) {
    const parts = lastSheet.receiptNumber.split("-");
    const lastPart = parts[parts.length - 1];
    const num = lastPart ? parseInt(lastPart, 10) : NaN;
    if (!isNaN(num)) nextNum = num + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

// POST /api/fund-office/daily-sheets/sync-or-create
export const syncOrCreateDailySheet = async (req: Request, res: Response) => {
  try {
    const {
      doctorId,
      date,
      sessionName = "All Day",
      consultationFee: customFee,
      commissionRate: customRate,
      otherAdjustments = 0,
      remarks,
      patientItems: manualItems
    } = req.body;

    if (!doctorId || !date) {
      return res.status(400).json({ success: false, error: "doctorId and date are required" });
    }

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { Role: true }
    });

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    const { start, end } = getDayRange(date);

    // Determine applicable per-patient fee and commission rate
    const defaultDoctorFee = doctor.consultationFee || 2500;
    const effectiveFee = customFee !== undefined && customFee !== null && customFee !== ""
      ? parseFloat(customFee)
      : defaultDoctorFee;

    const defaultCommissionRate = doctor.commissionRate ?? 20; // Default 20%
    const effectiveCommissionRate = customRate !== undefined && customRate !== null && customRate !== ""
      ? parseFloat(customRate)
      : defaultCommissionRate;

    // Build patient item roster
    let itemsToSave: {
      patientName: string;
      patientId?: string;
      appointmentId?: string;
      tokenNumber?: string;
      consultationFee: number;
      hospitalShare: number;
      doctorShare: number;
      time?: Date;
      remarks?: string;
    }[] = [];

    if (Array.isArray(manualItems) && manualItems.length > 0) {
      // Use provided patient items
      itemsToSave = manualItems.map((item: any) => {
        const itemFee = parseFloat(item.consultationFee) || effectiveFee;
        const hospitalShare = Math.round(itemFee * (effectiveCommissionRate / 100) * 100) / 100;
        const doctorShare = Math.round((itemFee - hospitalShare) * 100) / 100;
        return {
          patientName: item.patientName || "Walk-in Patient",
          patientId: item.patientId || null,
          appointmentId: item.appointmentId || null,
          tokenNumber: item.tokenNumber || null,
          consultationFee: itemFee,
          hospitalShare,
          doctorShare,
          time: item.time ? new Date(item.time) : new Date(),
          remarks: item.remarks || null
        };
      });
    } else {
      // Auto-sync from completed appointments for this doctor on this day
      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          OR: [
            { appointmentDate: { gte: start, lte: end } },
            { completedAt: { gte: start, lte: end } },
            { createdAt: { gte: start, lte: end } }
          ],
          status: { in: ["COMPLETED", "CHECKED_IN", "IN_PROGRESS"] }
        },
        include: {
          Patient: true,
          Payment: true
        },
        orderBy: { bookedAt: "asc" }
      });

      const visitIds = appointments.map((a) => a.id);
      const paidInvoices = await prisma.invoice.findMany({
        where: {
          visitId: { in: visitIds },
          status: "PAID"
        },
        include: { lineItems: true }
      });

      if (appointments.length > 0) {
        itemsToSave = appointments.map((apt) => {
          const inv = paidInvoices.find((i) => i.visitId === apt.id);
          const consultLi = inv?.lineItems.find(
            (li: any) =>
              li.department === "CONSULTATION" ||
              li.description?.toLowerCase().includes("consultation")
          );
          const itemFee =
            consultLi?.total || inv?.totalAmount || apt.Payment?.amount || effectiveFee;
          const hospitalShare = Math.round(itemFee * (effectiveCommissionRate / 100) * 100) / 100;
          const doctorShare = Math.round((itemFee - hospitalShare) * 100) / 100;
          return {
            patientName: apt.Patient?.fullName || "Patient",
            patientId: apt.patientId,
            appointmentId: apt.id,
            tokenNumber: apt.tokenNumber,
            consultationFee: itemFee,
            hospitalShare,
            doctorShare,
            time: apt.completedAt || apt.appointmentDate || apt.createdAt,
            remarks: apt.bookingType || "Appointment"
          };
        });
      }
 else {
        // Create an initial placeholder entry if totalPatients was given as a single count
        const count = parseInt(req.body.totalPatients, 10) || 0;
        for (let i = 1; i <= count; i++) {
          const itemFee = effectiveFee;
          const hospitalShare = Math.round(itemFee * (effectiveCommissionRate / 100) * 100) / 100;
          const doctorShare = Math.round((itemFee - hospitalShare) * 100) / 100;
          itemsToSave.push({
            patientName: `Patient #${i}`,
            consultationFee: itemFee,
            hospitalShare,
            doctorShare,
            time: start,
            remarks: "Batch record"
          });
        }
      }
    }

    const totalPatients = itemsToSave.length;
    const totalRevenue = itemsToSave.reduce((sum, it) => sum + it.consultationFee, 0);
    const hospitalCommission = Math.round(totalRevenue * (effectiveCommissionRate / 100) * 100) / 100;
    const adjustments = parseFloat(otherAdjustments) || 0;
    const netDoctorPayment = Math.round((totalRevenue - hospitalCommission - adjustments) * 100) / 100;

    const result = await prisma.$transaction(async (tx) => {
      // Check existing sheet for doctor & date
      const existing = await tx.doctorDailySheet.findFirst({
        where: { doctorId, date: { gte: start, lte: end } }
      });

      let sheet;
      if (existing) {
        // Update sheet and replace patient items
        await tx.doctorDailyPatientItem.deleteMany({ where: { dailySheetId: existing.id } });
        sheet = await tx.doctorDailySheet.update({
          where: { id: existing.id },
          data: {
            sessionName,
            totalPatients,
            consultationFee: effectiveFee,
            totalRevenue,
            commissionRate: effectiveCommissionRate,
            hospitalCommission,
            otherAdjustments: adjustments,
            netDoctorPayment,
            remarks,
            patientItems: {
              create: itemsToSave
            }
          },
          include: { patientItems: true, doctor: true }
        });
      } else {
        sheet = await tx.doctorDailySheet.create({
          data: {
            doctorId,
            date: start,
            sessionName,
            totalPatients,
            consultationFee: effectiveFee,
            totalRevenue,
            commissionRate: effectiveCommissionRate,
            hospitalCommission,
            otherAdjustments: adjustments,
            netDoctorPayment,
            status: "DRAFT",
            remarks,
            patientItems: {
              create: itemsToSave
            }
          },
          include: { patientItems: true, doctor: true }
        });
      }

      return sheet;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    console.error("syncOrCreateDailySheet error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/fund-office/daily-sheets
export const getDailySheets = async (req: Request, res: Response) => {
  try {
    const { doctorId, status, startDate, endDate, date } = req.query;

    const where: any = {};
    if (doctorId && doctorId !== "ALL") where.doctorId = String(doctorId);
    if (status && status !== "ALL") where.status = String(status);

    if (date) {
      const { start, end } = getDayRange(String(date));
      where.date = { gte: start, lte: end };
    } else if (startDate && endDate) {
      where.date = {
        gte: new Date(String(startDate)),
        lte: new Date(String(endDate))
      };
    }

    const sheets = await prisma.doctorDailySheet.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        doctor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            specialty: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } }
          }
        },
        _count: { select: { patientItems: true } }
      }
    });

    res.json({ success: true, data: sheets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/fund-office/daily-sheets/:id
export const getDailySheetById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sheet = await prisma.doctorDailySheet.findUnique({
      where: { id },
      include: {
        doctor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            specialty: true,
            consultationFee: true,
            commissionRate: true,
            Role: { select: { name: true } },
            Department: { select: { name: true } }
          }
        },
        patientItems: {
          orderBy: { time: "asc" }
        }
      }
    });

    if (!sheet) return res.status(404).json({ success: false, error: "Daily sheet not found" });

    res.json({ success: true, data: sheet });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /api/fund-office/daily-sheets/:id/verify
export const verifyDailySheet = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const authUser = (req as any).user;

    const sheet = await prisma.doctorDailySheet.findUnique({ where: { id } });
    if (!sheet) return res.status(404).json({ success: false, error: "Daily sheet not found" });

    const updated = await prisma.doctorDailySheet.update({
      where: { id },
      data: {
        status: "VERIFIED",
        verifiedById: authUser?.id || null,
        verifiedAt: new Date()
      },
      include: { doctor: true }
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "DoctorDailySheet",
          entityId: id,
          action: "DOCTOR_PAYMENT_VERIFIED",
          description: `Fund Office verified daily sheet for ${updated.doctor.fullName} (LKR ${updated.netDoctorPayment})`,
          userId: authUser.id
        }
      }).catch(err => console.error(err));
    }

    res.json({ success: true, data: updated, message: "Doctor daily sheet verified by Fund Office" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /api/fund-office/daily-sheets/:id/approve
export const approveDailySheet = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const authUser = (req as any).user;

    const sheet = await prisma.doctorDailySheet.findUnique({ where: { id } });
    if (!sheet) return res.status(404).json({ success: false, error: "Daily sheet not found" });

    const updated = await prisma.doctorDailySheet.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: authUser?.id || null,
        approvedAt: new Date()
      },
      include: { doctor: true }
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "DoctorDailySheet",
          entityId: id,
          action: "DOCTOR_PAYMENT_APPROVED",
          description: `Doctor payment approved for ${updated.doctor.fullName} (LKR ${updated.netDoctorPayment})`,
          userId: authUser.id
        }
      }).catch(err => console.error(err));
    }

    res.json({ success: true, data: updated, message: "Doctor payment approved for disbursement" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/fund-office/daily-sheets/:id/pay
export const markDailySheetPaid = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const authUser = (req as any).user;
    const { paymentMethod = "BANK_TRANSFER", paymentReference, paidAt } = req.body;

    if (!paymentReference) {
      return res.status(400).json({ success: false, error: "Payment Reference Number is required" });
    }

    const sheet = await prisma.doctorDailySheet.findUnique({ where: { id } });
    if (!sheet) return res.status(404).json({ success: false, error: "Daily sheet not found" });

    // Generate formal receipt number if not yet generated
    const receiptNumber = sheet.receiptNumber || await generateReceiptNumber();

    const updated = await prisma.doctorDailySheet.update({
      where: { id },
      data: {
        status: "PAID",
        paymentMethod,
        paymentReference,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        paidById: authUser?.id || null,
        receiptNumber
      },
      include: { doctor: true, patientItems: true }
    });

    if (authUser?.id) {
      await prisma.activityLog.create({
        data: {
          entityType: "DoctorDailySheet",
          entityId: id,
          action: "DOCTOR_PAYMENT_DISBURSED",
          description: `Paid LKR ${updated.netDoctorPayment} to ${updated.doctor.fullName} (Receipt: ${receiptNumber}, Ref: ${paymentReference})`,
          userId: authUser.id
        }
      }).catch(err => console.error(err));
    }

    res.json({
      success: true,
      data: updated,
      message: `Payment confirmed. Receipt ${receiptNumber} generated.`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/fund-office/dashboard-metrics
export const getFundOfficeMetrics = async (_req: Request, res: Response) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0] || "";
    const { start: todayStart, end: todayEnd } = getDayRange(todayStr);

    const [
      allSheets,
      todaySheets,
      pendingSheets,
      approvedSheets,
      paidSheets
    ] = await Promise.all([
      prisma.doctorDailySheet.findMany({
        where: { status: { not: "CANCELLED" } }
      }),
      prisma.doctorDailySheet.findMany({
        where: { date: { gte: todayStart, lte: todayEnd }, status: { not: "CANCELLED" } }
      }),
      prisma.doctorDailySheet.findMany({
        where: { status: { in: ["DRAFT", "VERIFIED"] } }
      }),
      prisma.doctorDailySheet.findMany({
        where: { status: "APPROVED" }
      }),
      prisma.doctorDailySheet.findMany({
        where: { status: "PAID" }
      })
    ]);

    // 1. Today's Doctor Payments (Sum of doctor net payments scheduled or paid today)
    const todayDoctorPayments = todaySheets.reduce((sum, s) => sum + s.netDoctorPayment, 0);

    // 2. Pending Doctor Payments (Awaiting verification / approval)
    const pendingDoctorPayments = pendingSheets.reduce((sum, s) => sum + s.netDoctorPayment, 0);

    // 3. Approved Payments (Ready for disbursement)
    const approvedPayments = approvedSheets.reduce((sum, s) => sum + s.netDoctorPayment, 0);

    // 4. Paid Payments (Completed)
    const paidPayments = paidSheets.reduce((sum, s) => sum + s.netDoctorPayment, 0);

    // 5. Hospital Commission (Total hospital commission earned from all active sheets)
    const hospitalCommission = allSheets.reduce((sum, s) => sum + s.hospitalCommission, 0);

    // 6. Total Daily Revenue (Gross consultation revenue today)
    const totalDailyRevenue = todaySheets.reduce((sum, s) => sum + s.totalRevenue, 0);

    res.json({
      success: true,
      data: {
        todayDoctorPayments,
        pendingDoctorPayments,
        pendingCount: pendingSheets.length,
        approvedPayments,
        approvedCount: approvedSheets.length,
        paidPayments,
        paidCount: paidSheets.length,
        hospitalCommission,
        totalDailyRevenue,
        todayPatientsCount: todaySheets.reduce((sum, s) => sum + s.totalPatients, 0)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/fund-office/doctor-reports
export const getDoctorWiseReports = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const where: any = { status: { not: "CANCELLED" } };

    if (startDate && endDate) {
      where.date = {
        gte: new Date(String(startDate)),
        lte: new Date(String(endDate))
      };
    }

    const sheets = await prisma.doctorDailySheet.findMany({
      where,
      include: {
        doctor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            specialty: true,
            Department: { select: { name: true } }
          }
        }
      }
    });

    // Group by doctor
    const reportMap = new Map<string, {
      doctorId: string;
      doctorName: string;
      specialty: string;
      department: string;
      totalDays: number;
      totalPatients: number;
      grossRevenue: number;
      hospitalCommission: number;
      netDoctorPayment: number;
      paidAmount: number;
      pendingAmount: number;
    }>();

    for (const s of sheets) {
      const docId = s.doctorId;
      const existing = reportMap.get(docId) || {
        doctorId: docId,
        doctorName: s.doctor.fullName,
        specialty: s.doctor.specialty || "General",
        department: s.doctor.Department?.name || "OPD",
        totalDays: 0,
        totalPatients: 0,
        grossRevenue: 0,
        hospitalCommission: 0,
        netDoctorPayment: 0,
        paidAmount: 0,
        pendingAmount: 0
      };

      existing.totalDays += 1;
      existing.totalPatients += s.totalPatients;
      existing.grossRevenue += s.totalRevenue;
      existing.hospitalCommission += s.hospitalCommission;
      existing.netDoctorPayment += s.netDoctorPayment;

      if (s.status === "PAID") {
        existing.paidAmount += s.netDoctorPayment;
      } else {
        existing.pendingAmount += s.netDoctorPayment;
      }

      reportMap.set(docId, existing);
    }

    res.json({ success: true, data: Array.from(reportMap.values()) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Auto-record or update consultation in doctor daily sheet
export async function recordCompletedConsultationInDailySheet(appointmentId: string) {
  try {
    const apt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        User: true,
        Patient: true
      }
    });

    if (!apt || !apt.doctorId) return;

    const doctor = await prisma.user.findUnique({
      where: { id: apt.doctorId }
    });
    if (!doctor) return;

    const commissionRate = doctor.commissionRate ?? 20;

    // Find any invoice paid for this appointment
    const invoice = await prisma.invoice.findFirst({
      where: { visitId: apt.id, status: "PAID" },
      include: { lineItems: true }
    });

    let consultationFee = doctor.consultationFee ?? 3000;
    if (invoice) {
      const consultItem = invoice.lineItems.find(
        (li: any) =>
          li.department === "CONSULTATION" ||
          li.description?.toLowerCase().includes("consultation")
      );
      if (consultItem && consultItem.total > 0) {
        consultationFee = consultItem.total;
      } else if (invoice.totalAmount > 0) {
        consultationFee = invoice.totalAmount;
      }
    }

    const hospitalShare = Math.round(consultationFee * (commissionRate / 100) * 100) / 100;
    const doctorShare = Math.round((consultationFee - hospitalShare) * 100) / 100;

    // Normalize clinic date
    const aptDate = apt.completedAt || apt.appointmentDate || apt.createdAt || new Date();
    const sheetDate = new Date(aptDate.getFullYear(), aptDate.getMonth(), aptDate.getDate(), 0, 0, 0, 0);

    // Find or create daily sheet
    let sheet = await prisma.doctorDailySheet.findFirst({
      where: {
        doctorId: doctor.id,
        date: sheetDate
      },
      include: {
        patientItems: true
      }
    });

    if (!sheet) {
      sheet = await prisma.doctorDailySheet.create({
        data: {
          doctorId: doctor.id,
          date: sheetDate,
          sessionName: "All Day",
          consultationFee,
          commissionRate,
          status: "DRAFT"
        },
        include: {
          patientItems: true
        }
      });
    }

    // Check if item already exists for this appointment
    const existingItem = await prisma.doctorDailyPatientItem.findFirst({
      where: {
        dailySheetId: sheet.id,
        OR: [
          { appointmentId: apt.id },
          ...(apt.tokenNumber ? [{ tokenNumber: apt.tokenNumber }] : [])
        ]
      }
    });

    if (existingItem) {
      await prisma.doctorDailyPatientItem.update({
        where: { id: existingItem.id },
        data: {
          patientName: apt.Patient?.fullName || "Patient",
          consultationFee,
          hospitalShare,
          doctorShare,
          time: apt.completedAt || new Date(),
          remarks: "Consultation Completed"
        }
      });
    } else {
      await prisma.doctorDailyPatientItem.create({
        data: {
          dailySheetId: sheet.id,
          patientName: apt.Patient?.fullName || "Patient",
          patientId: apt.patientId,
          appointmentId: apt.id,
          tokenNumber: apt.tokenNumber,
          consultationFee,
          hospitalShare,
          doctorShare,
          time: apt.completedAt || new Date(),
          remarks: "Consultation Completed"
        }
      });
    }

    // Recalculate sheet totals
    const allItems = await prisma.doctorDailyPatientItem.findMany({
      where: { dailySheetId: sheet.id }
    });

    const totalPatients = allItems.length;
    const totalRevenue = allItems.reduce((sum, it) => sum + it.consultationFee, 0);
    const totalHospitalCommission = Math.round(totalRevenue * (sheet.commissionRate / 100) * 100) / 100;
    const netDoctorPayment = Math.max(0, totalRevenue - totalHospitalCommission - sheet.otherAdjustments);

    await prisma.doctorDailySheet.update({
      where: { id: sheet.id },
      data: {
        totalPatients,
        totalRevenue,
        hospitalCommission: totalHospitalCommission,
        netDoctorPayment
      }
    });
  } catch (err) {
    console.error("Error in recordCompletedConsultationInDailySheet:", err);
  }
}

// GET /api/fund-office/doctor-summary
export const getDoctorEarningsSummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const doctorId = (req.query.doctorId as string) || user?.id;

    if (!doctorId) {
      return res.status(400).json({ success: false, error: "doctorId required" });
    }

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { Role: true, Department: true }
    });

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    const todayStr = new Date().toISOString().split("T")[0] || "";
    const { start: todayStart, end: todayEnd } = getDayRange(todayStr);

    // 1. Check if there is a daily sheet for today
    let dailySheet = await prisma.doctorDailySheet.findFirst({
      where: {
        doctorId,
        date: { gte: todayStart, lte: todayEnd }
      },
      include: {
        patientItems: true
      }
    });

    // 2. Also check completed appointments today to ensure everything is synced
    const completedAppointmentsToday = await prisma.appointment.findMany({
      where: {
        doctorId,
        status: "COMPLETED",
        OR: [
          { completedAt: { gte: todayStart, lte: todayEnd } },
          { appointmentDate: { gte: todayStart, lte: todayEnd } },
          { createdAt: { gte: todayStart, lte: todayEnd } }
        ]
      },
      include: {
        Patient: true
      }
    });

    // Auto-sync if sheet is missing or has fewer items than completed appointments
    if ((!dailySheet && completedAppointmentsToday.length > 0) ||
        (dailySheet && dailySheet.patientItems.length < completedAppointmentsToday.length)) {
      for (const apt of completedAppointmentsToday) {
        await recordCompletedConsultationInDailySheet(apt.id);
      }
      dailySheet = await prisma.doctorDailySheet.findFirst({
        where: {
          doctorId,
          date: { gte: todayStart, lte: todayEnd }
        },
        include: {
          patientItems: true
        }
      });
    }

    // Doctor all-time stats
    const allSheets = await prisma.doctorDailySheet.findMany({
      where: { doctorId, status: { not: "CANCELLED" } }
    });

    const totalEarned = allSheets.reduce((sum, s) => sum + s.netDoctorPayment, 0);
    const totalPaid = allSheets.filter(s => s.status === "PAID").reduce((sum, s) => sum + s.netDoctorPayment, 0);
    const totalPending = allSheets.filter(s => s.status !== "PAID").reduce((sum, s) => sum + s.netDoctorPayment, 0);

    const todayShare = dailySheet ? dailySheet.netDoctorPayment : 0;
    const todayRevenue = dailySheet ? dailySheet.totalRevenue : 0;
    const todayCommission = dailySheet ? dailySheet.hospitalCommission : 0;
    const todayPatients = dailySheet ? dailySheet.totalPatients : completedAppointmentsToday.length;

    res.json({
      success: true,
      data: {
        doctorId: doctor.id,
        doctorName: doctor.fullName,
        specialty: doctor.specialty || "Doctor",
        commissionRate: doctor.commissionRate ?? 20,
        todayDoctorShare: todayShare,
        todayRevenue,
        todayCommission,
        todayPatientsCount: todayPatients,
        todaySheetStatus: dailySheet?.status || "NO_SHEET",
        dailySheet,
        totalEarned,
        totalPaid,
        totalPending,
        patientItems: dailySheet?.patientItems || []
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
