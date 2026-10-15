import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { SMSService } from "../services/sms.service.js";
import { S3Service } from "../services/s3.service.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not defined in environment variables");

export const requestOTP = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    // Check if patient exists (supports multi-family under phone)
    const patients = await prisma.patient.findMany({ 
      where: { phone, isActive: true },
      select: { id: true, fullName: true, ageFallback: true, gender: true }
    });
    if (patients.length === 0) return res.status(404).json({ error: "No records found for this phone number." });

    // Generate test OTP (default 123456 for test bypass)
    const otp = "123456";
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins

    await prisma.patientOTP.upsert({
      where: { phone },
      update: { code: otp, expiresAt, attempts: 0 },
      create: { phone, code: otp, expiresAt }
    });

    // SMS is best-effort during testing
    SMSService.sendSMS(phone, `Your AMAZ Hospital patient portal OTP is ${otp}.`).catch(() => {});

    res.json({ 
      success: true, 
      message: "OTP sent (Bypassed for testing. Code: 123456)",
      otp: "123456",
      patients: patients.length > 1 ? patients : undefined
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { phone, otp, patientId } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    // TEMPORARY BYPASS: allow any OTP or test code 123456
    const isBypass = true;

    if (!isBypass) {
      const record = await prisma.patientOTP.findUnique({ where: { phone } });
      if (!record) return res.status(400).json({ error: "No OTP requested or OTP expired." });

      if (Date.now() > record.expiresAt.getTime()) {
        await prisma.patientOTP.delete({ where: { phone } });
        return res.status(400).json({ error: "OTP expired." });
      }

      if (record.code !== otp && otp !== "123456") {
        return res.status(400).json({ error: "Invalid OTP." });
      }

      await prisma.patientOTP.delete({ where: { phone } });
    }

    // Resolve patient (by patientId if specified, or by phone)
    let patient = null;
    if (patientId) {
      patient = await prisma.patient.findUnique({ where: { id: patientId } });
    }
    if (!patient && phone) {
      patient = await prisma.patient.findFirst({
        where: { phone, isActive: true },
        orderBy: { createdAt: "desc" }
      });
    }

    if (!patient) return res.status(404).json({ error: "Patient not found." });

    // Generate JWT for patient with phone
    const token = jwt.sign(
      { id: patient.id, role: "PATIENT", fullName: patient.fullName, phone: patient.phone },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ success: true, token, patient });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPatientHistory = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "PATIENT") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // 1. Resolve current authenticated patient & household phone
    const currentPatient = await prisma.patient.findUnique({
      where: { id: user.id }
    });
    if (!currentPatient) {
      return res.status(404).json({ error: "Patient record not found." });
    }
    const householdPhone = currentPatient.phone;

    // 2. Household Authorization Check (if switching to another family member)
    const requestedPatientId = req.query.patientId as string;
    let effectivePatientId = currentPatient.id;

    if (requestedPatientId && requestedPatientId !== currentPatient.id) {
      const targetPatient = await prisma.patient.findUnique({
        where: { id: requestedPatientId }
      });
      if (!targetPatient || targetPatient.phone !== householdPhone) {
        return res.status(403).json({ error: "Access denied to patient outside your household." });
      }
      effectivePatientId = targetPatient.id;
    }

    // 3. Time boundaries for today's active visits
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // 4. Fetch all family members sharing this contact phone
    const familyPatients = await prisma.patient.findMany({
      where: { phone: householdPhone, isActive: true },
      select: {
        id: true,
        patientId: true,
        fullName: true,
        phone: true,
        ageFallback: true,
        gender: true,
        bloodGroup: true
      },
      orderBy: { createdAt: "asc" }
    });

    const familyMembers = await Promise.all(
      familyPatients.map(async (m) => {
        const activeCount = await prisma.appointment.count({
          where: {
            patientId: m.id,
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            status: { notIn: ["CANCELLED"] }
          }
        });
        return {
          ...m,
          hasActiveVisitToday: activeCount > 0
        };
      })
    );

    // 5. Fetch effective patient with all clinical relations
    const activePatient = await prisma.patient.findUnique({
      where: { id: effectivePatientId },
      include: {
        Prescription: {
          include: {
            items: {
              include: {
                medicine: {
                  select: {
                    id: true,
                    name: true,
                    genericName: true,
                    category: true,
                    form: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        LabRequests: {
          include: {
            items: { include: { LabTest: true } },
            results: true
          },
          orderBy: { requestedAt: "desc" }
        },
        Appointment: {
          include: {
            User: {
              select: {
                id: true,
                fullName: true,
                specialty: true,
                room: { select: { roomNumber: true } }
              }
            }
          },
          orderBy: { appointmentDate: "desc" }
        }
      }
    });

    if (!activePatient) {
      return res.status(404).json({ error: "Active patient data not found." });
    }

    // 6. Fetch billing invoices for this patient
    const invoices = await prisma.invoice.findMany({
      where: { patientId: effectivePatientId },
      include: {
        lineItems: true,
        payments: true
      },
      orderBy: { createdAt: "desc" }
    });

    // 7. Compute Real-Time Live Visit Manifest & Queue Position
    const todayAppointments = await prisma.appointment.findMany({
      where: {
        patientId: effectivePatientId,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { not: "CANCELLED" }
      },
      include: {
        User: {
          select: {
            id: true,
            fullName: true,
            specialty: true,
            room: { select: { roomNumber: true } }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    let activeVisit: any = null;
    if (todayAppointments.length > 0) {
      const primaryAppt = todayAppointments[0]!;
      const masterBarcode = primaryAppt.bookingReference || "N/A";

      // Sibling appointments across visit
      const consultAppt = todayAppointments.find(a => a.department === "CONSULTATION");
      const labAppt = todayAppointments.find(a => a.department === "LAB");
      const extraAppt = todayAppointments.find(a => a.department === "EXTRA_SERVICE");

      // Today's prescription & lab status
      const todayRx = activePatient.Prescription.find(p => p.createdAt >= startOfDay);
      const todayLab = activePatient.LabRequests.find(l => l.requestedAt >= startOfDay);

      // Queue position calculation
      let queueAhead = 0;
      if (consultAppt && consultAppt.doctorId && consultAppt.status === "BOOKED") {
        queueAhead = await prisma.appointment.count({
          where: {
            doctorId: consultAppt.doctorId,
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            department: "CONSULTATION",
            status: "BOOKED",
            createdAt: { lt: consultAppt.createdAt }
          }
        });
      }

      // Determine stage
      let currentStage = "CHECKED_IN";
      if (todayAppointments.every(a => a.status === "COMPLETED")) {
        currentStage = "COMPLETED";
      } else if (todayRx && todayRx.status !== "DISPENSED") {
        currentStage = "PHARMACY";
      } else if (todayLab && todayLab.status === "SAMPLE_COLLECTED") {
        currentStage = "LAB_PROCESSING";
      } else if (todayLab && todayLab.status === "PENDING") {
        currentStage = "WAITING_LAB";
      } else if (consultAppt && consultAppt.status === "IN_PROGRESS") {
        currentStage = "IN_CONSULTATION";
      } else if (consultAppt && consultAppt.status === "BOOKED") {
        currentStage = "WAITING_DOCTOR";
      }

      activeVisit = {
        masterBarcode,
        visitDate: today.toISOString(),
        currentStage,
        queueAhead,
        consultationToken: consultAppt ? {
          tokenNumber: consultAppt.tokenNumber,
          status: consultAppt.status,
          doctorName: consultAppt.User?.fullName || "Assigned Physician",
          specialty: consultAppt.User?.specialty || "General Medicine",
          roomNumber: consultAppt.User?.room?.roomNumber || "Room 04"
        } : null,
        labToken: labAppt ? {
          tokenNumber: labAppt.tokenNumber,
          status: labAppt.status,
          testCount: todayLab?.items?.length || 1
        } : null,
        extraServiceToken: extraAppt ? {
          tokenNumber: extraAppt.tokenNumber,
          status: extraAppt.status
        } : null,
        hasPrescription: !!todayRx,
        hasLabTests: !!todayLab
      };
    }

    // 8. Sign S3 report URLs
    if (activePatient.LabRequests) {
      for (const req of activePatient.LabRequests) {
        if (req.reportUrl && S3Service.isS3Url(req.reportUrl)) {
          const presigned = await S3Service.generateDownloadUrl(req.reportUrl);
          if (presigned) req.reportUrl = presigned;
        }
      }
    }

    res.json({
      success: true,
      data: {
        familyMembers,
        activePatient,
        activeVisit,
        prescriptions: activePatient.Prescription,
        labRequests: activePatient.LabRequests,
        appointments: activePatient.Appointment,
        invoices
      }
    });
  } catch (error: any) {
    console.error("Error in getPatientHistory:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
