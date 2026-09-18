import { Request, Response } from "express";
import { NotificationService } from "../services/notification.service.js";
import { prisma } from "../lib/prisma.js";

export const getPatients = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json({ success: true, data: [] });
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

export const generateToken = async (req: Request, res: Response) => {
  try {
    const { patientName, patientPhone, ageFallback, doctorId, doctorName, department } = req.body;

    // Find or create patient
    let patient;
    if (patientPhone) {
      patient = await prisma.patient.findUnique({ where: { phone: patientPhone } });
    }
    
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          fullName: patientName || "Walk-in Patient",
          phone: patientPhone || `WALKIN-${Date.now()}`, // Fallback phone for DB unique constraint
          ageFallback: ageFallback || null
        }
      });
    }

    const isLab = department === "LAB";
    
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
          department: isLab ? "LAB" : "CONSULTATION",
          ...(isLab ? {} : { doctorId })
        }
      });

      const queueNumber = (tokenCount + 1).toString().padStart(3, "0");
      const tokenDisplay = isLab ? `LAB-${queueNumber}` : queueNumber;

      return await tx.appointment.create({
        data: {
          tokenNumber: tokenDisplay,
          patientId: patient.id,
          doctorId: isLab ? null : doctorId,
          department: isLab ? "LAB" : "CONSULTATION",
          status: isLab ? "WAITING" : "waiting_for_counsiling_payment",
          appointmentDate: new Date()
        }
      });
    });

    const tokenDisplay = token.tokenNumber;

    if (patientPhone && !patientPhone.startsWith('WALKIN')) {
      await NotificationService.sendTemplatedSMS(
        patient.id,
        patientPhone,
        'APPOINTMENT_BOOKED',
        {
          patientName: patient.fullName,
          doctorName: isLab ? "Laboratory" : (doctorName || "General Physician"),
          appointmentDate: new Date().toLocaleDateString(),
          tokenNumber: tokenDisplay,
          hospitalName: "AMAZ Hospital"
        }
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id: token.id,
        refNo,
        queueNumber: tokenDisplay,
        patientName: patient.fullName,
        doctorName: isLab ? "Laboratory" : doctorName,
        department: isLab ? "LAB" : department,
        status: token.status
      }
    });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
