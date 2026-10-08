import { Router } from 'express';
import { verifyToken, requireRole, requirePermission } from '../middlewares/auth.middleware.js';
import * as frontdeskController from '../controllers/frontdesk.controller.js';
import * as roomController from '../controllers/room.controller.js';
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'RECEPTIONIST', 'NURSE']));

// Apply auth middleware to all routes
// Assuming receptionist, admin, superadmin have access
// router.use(requirePermission('manage', 'frontdesk')); // Temporarily disabled until RBAC UI is seeded

// Doctor Status & Attendance
router.get('/doctors/status', frontdeskController.getDoctorsStatus);
router.put('/doctors/:id/attendance', frontdeskController.updateDoctorAttendance);

// Room Management
router.get('/rooms/matrix', roomController.getRoomMatrix);

// Tokens & Appointments
router.get('/sessions/:sessionId/tokens', frontdeskController.getSessionTokens);
router.put('/appointments/:id/status', frontdeskController.updateAppointmentStatus);
router.post('/appointments/walk-in', frontdeskController.createWalkIn);

// Audit / Activity
router.get('/activity', frontdeskController.getActivityLog);

// Calendar & Scheduling
router.get('/doctors/:id/calendar', frontdeskController.getDoctorCalendar);
router.post('/doctors/schedules', frontdeskController.createDoctorSchedule);
router.put('/sessions/:id', frontdeskController.updateSession);
router.post('/sessions/:id/cancel', frontdeskController.cancelSession);
router.delete('/sessions/:id', frontdeskController.deleteSession);

// Doctor Leave Management
router.post('/doctors/leaves', frontdeskController.createDoctorLeave);
router.get('/doctors/:id/leaves', frontdeskController.getDoctorLeaves);
router.put('/doctors/leaves/:id/status', frontdeskController.updateDoctorLeaveStatus);

export default router;
