import { Request, Response } from "express";
import { NotificationService } from "../services/notification.service.js";
import { prisma } from "../lib/prisma.js";
import { randomUUID } from "crypto";
import { BookingService } from "../services/booking.service.js";
import { websocketService } from "../services/websocket.service.js";
import { SMSService } from "../services/sms.service.js";

export const getPatients = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      const recentPatients = await prisma.patient.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' }
      });
      return res.json({ success: true, data: recentPatients });
    }
    
    const patients = await prisma.patient.findMany({
      where: {
        phone: {
          contains: q as string
        }
      },
      take: 5
    });
    
    res.json({ success: true, data: patients });
  } catch (error) {
    console.error("Error fetching patients:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getMetrics = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Registered Today
    const registeredToday = await prisma.patient.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } }
    });

    // 2. Current Queue Size (All appointments today)
    const currentQueueSize = await prisma.appointment.count({
      where: { appointmentDate: { gte: startOfDay, lte: endOfDay } }
    });

    // 3. Available Doctors (Marked as ARRIVED today)
    const availableDoctors = await prisma.doctorAttendance.count({
      where: { date: { gte: startOfDay, lte: endOfDay }, status: "ARRIVED" }
    });

    // 4. Pending Appointments
    const pendingAppointments = await prisma.appointment.count({
      where: { appointmentDate: { gte: startOfDay, lte: endOfDay }, status: "BOOKED" }
    });

    // 5. Next in queue (Top 5 Booked or In Progress)
    const upcomingTokens = await prisma.appointment.findMany({
      where: { 
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      },
      include: { Patient: true, User: true },
      orderBy: { tokenNumber: 'asc' },
      take: 5
    });

    const nextInQueue = upcomingTokens.map(apt => {
      let mappedStatus = apt.status;
      if (mappedStatus === "BOOKED") mappedStatus = "WAITING";
      if (mappedStatus === "IN_PROGRESS") mappedStatus = "IN_CONSULTATION";

      return {
        queueNo: apt.tokenNumber,
        patientName: apt.Patient?.fullName || "Unknown",
        doctor: apt.User?.fullName || "Unassigned",
        status: mappedStatus
      };
    });

    res.json({
      success: true,
      data: {
        registeredToday,
        currentQueueSize,
        availableDoctors,
        pendingAppointments,
        nextInQueue
      }
    });
  } catch (error: any) {
    console.error("Error fetching metrics:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const generateToken = async (req: Request, res: Response) => {
  try {
    const { patientName, patientPhone, ageFallback, doctorId, doctorName, testIds } = req.body;

    // Find or create patient
    let patient;
    if (patientPhone) {
      patient = await prisma.patient.findUnique({ where: { phone: patientPhone } });
    }
    
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          fullName: patientName || "Walk-in Patient",
          phone: patientPhone || `WALKIN-${randomUUID()}`, // UUID fallback guarantees uniqueness under concurrency
          ageFallback: ageFallback || null
        }
      });
      
      if (patientPhone && !patientPhone.startsWith('WALKIN')) {
        SMSService.syncContact(patientPhone, patient.fullName).catch(console.error);
      }
    }

    const hasConsultation = !!doctorId;
    const hasLab = Array.isArray(testIds) && testIds.length > 0;
    
    let department = "CONSULTATION";
    if (hasConsultation && hasLab) {
      department = "MULTI";
    } else if (hasLab && !hasConsultation) {
      department = "LAB";
    }

    // Generate Token Number via Transaction
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const refNo = Math.floor(10000000 + Math.random() * 90000000).toString(); 

    const token = await prisma.$transaction(async (tx) => {
      const tokenCount = await tx.appointment.count({
        where: {
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          department
        }
      });

      const queueNumber = (tokenCount + 1).toString().padStart(3, "0");
      const prefix = department === "LAB" ? "LAB-" : (department === "MULTI" ? "MLT-" : "");
      const tokenDisplay = `${prefix}${queueNumber}`;

      return await tx.appointment.create({
        data: {
          tokenNumber: tokenDisplay,
          patientId: patient!.id,
          doctorId: doctorId || null,
          department,
          status: "BOOKED",
          bookingType: "WALK_IN",
          appointmentDate: new Date()
        }
      });
    });

    const tokenDisplay = token.tokenNumber;

    if (hasLab) {
      // Import dynamically or use a service to avoid circular dependencies if any
      const { labService } = await import('../services/lab.service.js');
      await labService.createRequest({
        patientId: patient.id,
        visitId: token.id,
        testIds,
        doctorId: doctorId || null,
        priority: "ROUTINE"
      });
    }

    if (patientPhone && !patientPhone.startsWith('WALKIN')) {
      let doctorDisplay = "Laboratory";
      if (hasConsultation && hasLab) doctorDisplay = `${doctorName || "General Physician"} + Lab`;
      else if (hasConsultation) doctorDisplay = doctorName || "General Physician";

      await NotificationService.sendTemplatedSMS(
        patient.id,
        patientPhone,
        'APPOINTMENT_BOOKED',
        {
          patientName: patient.fullName,
          doctorName: doctorDisplay,
          appointmentDate: new Date().toLocaleDateString(),
          tokenNumber: tokenDisplay,
          hospitalName: "AMAZ Hospital"
        }
      );
    }

    if (hasConsultation && typeof doctorId === 'string') {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const updatedAvailability = await BookingService.getAvailability(doctorId as string, todayStr as string);
        websocketService.emitToRoom(`doctor_${doctorId}_${todayStr}`, 'availability_updated', updatedAvailability);
      } catch (e) {
        console.error("Failed to broadcast availability update:", e);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        id: token.id,
        refNo,
        queueNumber: tokenDisplay,
        patientName: patient.fullName,
        doctorName: doctorName || (hasLab ? "Laboratory" : ""),
        department,
        status: token.status
      }
    });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
