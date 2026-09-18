import { Router } from "express";
import { generateToken, getDoctorQueue } from "../controllers/token.controller.js";

const router = Router();

router.post("/", generateToken);
router.get("/queue", getDoctorQueue);

export default router;
