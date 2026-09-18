import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { NotificationService } from "../services/notification.service.js";

export const markDoctorArrived = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    
    // 1. Mark doctor as arrived
    const attendance = await prisma.doctorAttendance.create({
      data: {
        doctorId,
        status: "ARRIVED",
        arrivedAt: new Date()
      }
    });

    // 2. Trigger notification service to send SMS to waiting patients
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
