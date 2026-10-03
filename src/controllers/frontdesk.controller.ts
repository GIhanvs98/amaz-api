import { Request, Response } from 'express';
import { FrontdeskService } from '../services/frontdesk.service.js';

const frontdeskService = new FrontdeskService();

export const getDoctorsStatus = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = typeof date === 'string' ? date : new Date().toISOString();
    const data = await frontdeskService.getDoctorsStatus(targetDate);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateDoctorAttendance = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    const { status, roomNumber, forceExit } = req.body;
    const userId = (req as any).user?.id;
    
    const data = await frontdeskService.updateDoctorAttendance(doctorId, status, roomNumber, userId, forceExit === true);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getSessionTokens = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const { date } = req.query;
    const targetDate = typeof date === 'string' ? date : new Date().toISOString();
    
    const data = await frontdeskService.getSessionTokens(sessionId, targetDate);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id as string;
    const { status } = req.body;
    const userId = (req as any).user?.id;

    const data = await frontdeskService.updateAppointmentStatus(appointmentId, status, userId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createWalkIn = async (req: Request, res: Response) => {
  try {
    const { doctorId, sessionId, patient } = req.body;
    const userId = (req as any).user?.id;

    const data = await frontdeskService.createWalkIn(doctorId, sessionId, patient, userId);
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getActivityLog = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = typeof date === 'string' ? date : new Date().toISOString();

    const data = await frontdeskService.getActivityLog(targetDate);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getDoctorCalendar = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    const { month } = req.query; // e.g., '2026-10'
    const data = await frontdeskService.getDoctorCalendar(doctorId, month as string);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createDoctorSchedule = async (req: Request, res: Response) => {
  try {
    const doctorId = req.body.doctorId;
    const userId = (req as any).user?.id;
    const data = await frontdeskService.createDoctorSchedule(doctorId, req.body, userId);
    res.status(201).json(data);
  } catch (error: any) {
    res.status(409).json({ error: error.message }); // 409 Conflict
  }
};

export const updateSession = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const userId = (req as any).user?.id;
    const data = await frontdeskService.updateSession(sessionId, req.body, userId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const cancelSession = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const { date, reason } = req.body;
    const userId = (req as any).user?.id;
    const data = await frontdeskService.cancelSession(sessionId, date, reason, userId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteSession = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const userId = (req as any).user?.id;
    const data = await frontdeskService.deleteSession(sessionId, userId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createDoctorLeave = async (req: Request, res: Response) => {
  try {
    const { scheduleId, startDate, endDate, reason } = req.body;
    const data = await frontdeskService.createDoctorLeave(scheduleId, startDate, endDate, reason);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getDoctorLeaves = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id as string;
    const data = await frontdeskService.getDoctorLeaves(doctorId);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateDoctorLeaveStatus = async (req: Request, res: Response) => {
  try {
    const leaveId = req.params.id as string;
    const { status } = req.body;
    const data = await frontdeskService.updateDoctorLeaveStatus(leaveId, status);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
