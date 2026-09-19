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
