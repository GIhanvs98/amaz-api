import { Request, Response } from "express";
import { BookingService } from "../services/booking.service.js";
import { prisma } from "../lib/prisma.js";

import { getTimezoneBoundaries } from "../lib/dateUtils.js";

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
    const { doctorId, date, sessionId } = req.query;
    if (!doctorId || !date) {
      return res.status(400).json({ success: false, error: "doctorId and date are required" });
    }
    const availability = await BookingService.getAvailability(doctorId as string, date as string, sessionId as string | undefined);
    res.json({ success: true, data: availability });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getDepartmentAvailability = async (req: Request, res: Response) => {
  try {
    const { department, date } = req.query;
    if (!department || !date) {
      return res.status(400).json({ success: false, error: "department and date are required" });
    }
    const availability = await BookingService.getDepartmentAvailability(department as string, date as string);
    res.json({ success: true, data: availability });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAvailableDates = async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.query;
    if (!doctorId) {
      return res.status(400).json({ success: false, error: "doctorId is required" });
    }
    const dates = await BookingService.getAvailableDates(doctorId as string);
    res.json({ success: true, data: dates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const bookPhoneToken = async (req: Request, res: Response) => {
  try {
    const { phone, fullName, doctorId, date, tokenNumber, sessionId } = req.body;
    if (!phone || !fullName || !doctorId || !date) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    const token = await BookingService.bookPhoneToken(phone, fullName, doctorId, date, tokenNumber, sessionId);
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
    const { date, startDate, endDate, doctorId, bookingType } = req.query;

    const whereClause: any = {};

    if (startDate && endDate) {
      const { startOfDay } = getTimezoneBoundaries(new Date(startDate as string));
      const { endOfDay } = getTimezoneBoundaries(new Date(endDate as string));
      whereClause.appointmentDate = { gte: startOfDay, lte: endOfDay };
    } else if (date) {
      const { startOfDay, endOfDay } = getTimezoneBoundaries(new Date(date as string));
      whereClause.appointmentDate = { gte: startOfDay, lte: endOfDay };
    } else {
      const { startOfDay, endOfDay } = getTimezoneBoundaries(new Date());
      whereClause.appointmentDate = { gte: startOfDay, lte: endOfDay };
    }

    if (doctorId && doctorId !== 'ALL' && doctorId !== '') {
      whereClause.doctorId = doctorId as string;
    }

    if (bookingType && bookingType !== 'ALL' && bookingType !== '') {
      whereClause.bookingType = bookingType as string;
    }

    const tokens = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        Patient: true,
        User: true,
        Session: true
      },
      orderBy: [
        { appointmentDate: 'asc' },
        { tokenNumber: 'asc' }
      ]
    });
    res.json({ success: true, data: tokens });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
