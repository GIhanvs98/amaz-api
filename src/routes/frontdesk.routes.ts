import { Router } from 'express';
import { verifyToken, requirePermission } from '../middlewares/auth.middleware.js';
import * as frontdeskController from '../controllers/frontdesk.controller.js';

const router = Router();

// Apply auth middleware to all routes
router.use(verifyToken);
// Assuming receptionist, admin, superadmin have access
// router.use(requirePermission('manage', 'frontdesk')); // Temporarily disabled until RBAC UI is seeded

// Doctor Status & Attendance
router.get('/doctors/status', frontdeskController.getDoctorsStatus);
router.put('/doctors/:id/attendance', frontdeskController.updateDoctorAttendance);

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

export default router;
