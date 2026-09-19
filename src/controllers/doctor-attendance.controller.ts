import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { NotificationService } from "../services/notification.service.js";

export const markDoctorArrived = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Prevent duplicate arrival records - check if already marked today
    const existingAttendance = await prisma.doctorAttendance.findFirst({
      where: {
        doctorId,
        date: { gte: startOfDay, lte: endOfDay },
        status: "ARRIVED"
      }
    });

    if (existingAttendance) {
      return res.status(409).json({
        success: false,
        error: "Doctor has already been marked as arrived today. SMS notifications were already sent."
      });
    }

    // 2. Mark doctor as arrived
    const attendance = await prisma.doctorAttendance.create({
      data: {
        doctorId,
        status: "ARRIVED",
        arrivedAt: new Date()
      }
    });

    // 3. Trigger notification service to send SMS to waiting patients
    const patientsNotified = await NotificationService.triggerDoctorArrived(doctorId, new Date());

    res.json({
      success: true,
      data: {
        attendance,
        patientsNotified
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDoctorsTodayStatus = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const doctors = await prisma.user.findMany({
      where: { Role: { name: "DOCTOR" } },
      select: {
        id: true,
        fullName: true,
        DoctorAttendance: {
          where: { date: { gte: startOfDay, lte: endOfDay } },
          orderBy: { date: 'desc' },
          take: 1
        }
      }
    });

    res.json({
      success: true,
      data: doctors.map(d => ({
        id: d.id,
        fullName: d.fullName,
        status: d.DoctorAttendance[0]?.status ?? "SCHEDULED",
        arrivedAt: d.DoctorAttendance[0]?.arrivedAt ?? null
      }))
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDoctorMetrics = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.query;
    
    if (!doctorId) {
      return res.status(400).json({ success: false, error: "doctorId is required" });
    }

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId as string }
    });

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    // Patients Today
    const patientsToday = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay }
      }
    });

    // Completed Consultations
    const completedConsultations = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: "COMPLETED"
      }
    });

    // Pending Queue (Booked / In Progress)
    const pendingQueue = await prisma.appointment.count({
      where: {
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      }
    });

    // Pending Prescriptions
    const pendingPrescriptions = await prisma.prescription.count({
      where: {
        doctorId: doctor.id,
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: "PENDING"
      }
    });

    // Pending Lab Requests
    const pendingLabRequests = await prisma.labRequest.count({
      where: {
        doctorId: doctor.id,
        requestedAt: { gte: startOfDay, lte: endOfDay },
        status: "PENDING"
      }
    });

    // Upcoming Patients
    const upcomingTokens = await prisma.appointment.findMany({
      where: { 
        doctorId: doctor.id,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      },
      include: { Patient: true },
      orderBy: { tokenNumber: 'asc' },
      take: 5
    });

    const upcomingPatients = upcomingTokens.map(apt => {
      let mappedStatus = apt.status;
      if (mappedStatus === "BOOKED") mappedStatus = "WAITING";
      if (mappedStatus === "IN_PROGRESS") mappedStatus = "IN_CONSULTATION";

      return {
        queueNo: apt.tokenNumber,
        patientId: apt.patientId,
        patientName: apt.Patient?.fullName || "Unknown",
        age: apt.Patient?.dateOfBirth ? new Date().getFullYear() - new Date(apt.Patient.dateOfBirth).getFullYear() : 45,
        reason: apt.department || "Consultation",
        status: mappedStatus
      };
    });

    res.json({
      success: true,
      data: {
        doctorName: doctor.fullName,
        specialty: doctor.specialty || "General Medicine",
        patientsToday,
        completedConsultations,
        pendingQueue,
        pendingPrescriptions,
        pendingLabRequests,
        upcomingPatients
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
