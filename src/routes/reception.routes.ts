import { Router } from "express";
import { generateToken } from "../controllers/reception.controller.js";

const router = Router();

// POST /api/reception/token
router.post("/token", generateToken);

export default router;
