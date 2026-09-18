import { Request, Response } from "express";
import { BookingService } from "../services/booking.service.js";
import { prisma } from "../lib/prisma.js";

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await BookingService.getDoctors();
    res.json({ success: true, data: doctors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAvailability = async (req: Request, res: Response) => {
  try {
    const { doctorId, date } = req.query;
    if (!doctorId || !date) {
      return res.status(400).json({ success: false, error: "doctorId and date are required" });
    }
    const availability = await BookingService.getAvailability(doctorId as string, date as string);
    res.json({ success: true, data: availability });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const bookPhoneToken = async (req: Request, res: Response) => {
  try {
    const { phone, fullName, doctorId, date } = req.body;
    if (!phone || !fullName || !doctorId || !date) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    const token = await BookingService.bookPhoneToken(phone, fullName, doctorId, date);
    res.status(201).json({ success: true, data: token });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const markArrived = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await BookingService.markArrived(id as string);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const getTodayAppointments = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Query all appointments for the specified date
    const tokens = await prisma.token.findMany({
      where: {
        appointmentDate: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        Patient: true,
        User: true
      },
      orderBy: { tokenNumber: 'asc' }
    });
    res.json({ success: true, data: tokens });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
