import { Router } from 'express';
import { financeController } from "../controllers/finance.controller.js";

const router = Router();

router.get('/dashboard', financeController.getDashboardData.bind(financeController));

export default router;
