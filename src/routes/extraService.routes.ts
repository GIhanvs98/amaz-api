import { Router } from "express";
import { extraServiceController } from "../controllers/extraService.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.get("/", cacheMiddleware(3600), extraServiceController.getServices.bind(extraServiceController));
router.post("/", extraServiceController.createService.bind(extraServiceController));
router.put("/:id", extraServiceController.updateService.bind(extraServiceController));
router.delete("/:id", extraServiceController.deleteService.bind(extraServiceController));

export default router;
