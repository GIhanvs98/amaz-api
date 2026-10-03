import { Router } from 'express';
import { financeController } from "../controllers/finance.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.get('/dashboard', cacheMiddleware(300), financeController.getDashboardData.bind(financeController));

export default router;
