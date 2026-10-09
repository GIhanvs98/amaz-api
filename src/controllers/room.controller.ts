import { Request, Response } from 'express';
import { roomService } from '../services/room.service.js';
import { prisma } from '../lib/prisma.js';

export class RoomController {
  async getAllRooms(req: Request, res: Response) {
    try {
      const rooms = await roomService.getAllRooms();
      res.json(rooms);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRoomById(req: Request, res: Response) {
    try {
      const room = await roomService.getRoomById(req.params.id as string);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      res.json(room);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createRoom(req: Request, res: Response) {
    try {
      const room = await roomService.createRoom(req.body);
      res.status(201).json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateRoom(req: Request, res: Response) {
    try {
      const room = await roomService.updateRoom(req.params.id as string, req.body);
      res.json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteRoom(req: Request, res: Response) {
    try {
      await roomService.deleteRoom(req.params.id as string);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateRoomStatus(req: Request, res: Response) {
    try {
      const room = await roomService.updateRoomStatus(req.params.id as string, req.body.status);
      res.json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getRoomMatrix(req: Request, res: Response) {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: "Date is required" });

      const targetDate = new Date(date as string);
      const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

      const attendances = await prisma.doctorAttendance.findMany({
        where: {
          date: { gte: startOfDay, lte: endOfDay },
          roomId: { not: null },
          status: { not: "LEFT" }
        },
        include: {
          doctor: { select: { fullName: true } }
        }
      });

      const actualRooms = await roomService.getAllRooms();
      
      const rooms = actualRooms.map((r: any) => {
        const bookings = attendances
          .filter(a => a.roomId === r.id)
          .map(a => ({
            doctorId: a.doctorId,
            doctorName: a.doctor.fullName,
            startTime: a.expectedStartTime || "08:00",
            endTime: a.expectedEndTime || "20:00",
            status: a.status
          }));

        return {
          id: r.id,
          name: r.roomNumber,
          department: r.department,
          status: r.status,
          description: r.description,
          isActive: r.isActive,
          bookings
        };
      });

      res.json(rooms);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch room matrix" });
    }
  }
}

export const roomController = new RoomController();
