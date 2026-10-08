import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { generateToken, getPatients, getMetrics, getPatientById, markDoctorArrived, markDoctorOut, updateShiftPeriod, getActiveDoctors, checkoutAppointment, getPOSHistory, closeShiftAndGetSummary, openShift } from "../controllers/reception.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import { updatePatient } from "../controllers/patient.controller.js";

const router = Router();

router.use(verifyToken);

// Doctor needs access to patient details and updates during consultation
router.get("/patients/:id", requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR']), getPatientById);
router.patch("/patients/:id", requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR']), updatePatient);

router.use(requireRole(['ADMIN', 'RECEPTIONIST']));

// GET /api/reception/patients
router.get("/patients", cacheMiddleware(60), getPatients);

// GET /api/reception/doctors
router.get("/doctors", getActiveDoctors);

// GET /api/reception/metrics
router.get("/metrics", cacheMiddleware(300), getMetrics);

// POST /api/reception/token
router.post("/token", generateToken);

// POST /api/reception/checkout-appointment
router.post("/checkout-appointment", checkoutAppointment);

// GET /api/reception/history
router.get("/history", getPOSHistory);

// POST /api/reception/shift-summary
router.post("/shift-summary", closeShiftAndGetSummary);

// POST /api/reception/open-shift
router.post("/open-shift", openShift);

// POST /api/reception/doctors/:id/arrive
router.post("/doctors/:id/arrive", markDoctorArrived);

// POST /api/reception/doctors/:id/out
router.post("/doctors/:id/out", markDoctorOut);

// POST /api/reception/doctors/:id/shift
router.post("/doctors/:id/shift", updateShiftPeriod);

export default router;
