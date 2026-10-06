import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// Assume we have a fixed number of rooms for now, e.g., 10 rooms
const TOTAL_ROOMS = 10;

export const getRoomMatrix = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date is required" });

    const targetDate = new Date(date as string);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Fetch all doctor attendances for the given date that have a room assigned
    const attendances = await prisma.doctorAttendance.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay },
        roomNumber: { not: null },
        status: { not: "LEFT" }
      },
      include: {
        doctor: { select: { fullName: true } }
      }
    });

    const rooms = Array.from({ length: TOTAL_ROOMS }, (_, i) => {
      const roomName = `Room ${String(i + 1).padStart(2, '0')}`;
      
      // Find all bookings for this room today
      const bookings = attendances
        .filter(a => a.roomNumber === roomName)
        .map(a => ({
          doctorId: a.doctorId,
          doctorName: a.doctor.fullName,
          startTime: a.expectedStartTime || "08:00", // Default to morning if not set
          endTime: a.expectedEndTime || "20:00",
          status: a.status
        }));

      return {
        id: roomName,
        name: roomName,
        bookings
      };
    });

    res.json(rooms);
  } catch (error: any) {
    console.error("Error fetching room matrix:", error);
    res.status(500).json({ error: "Failed to fetch room matrix" });
  }
};
