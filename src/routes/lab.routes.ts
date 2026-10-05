import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from 'express';
import { labController } from "../controllers/lab.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['SUPERADMIN', 'ADMIN', 'LABTECH', 'DOCTOR', 'RECEPTIONIST']));

// GET /api/lab/upload-url
router.get('/upload-url', labController.getUploadUrl.bind(labController));

// GET /api/lab/queue
router.get('/queue', labController.getQueueTokens.bind(labController));

// GET /api/lab/catalog
router.get('/catalog', cacheMiddleware(3600), labController.getCatalog.bind(labController));

// POST /api/lab/catalog
router.post('/catalog', labController.addTestToCatalog.bind(labController));

// PATCH /api/lab/tests/:testId
router.patch('/tests/:testId', labController.updateTestInCatalog.bind(labController));

// DELETE /api/lab/tests/:testId
router.delete('/tests/:testId', labController.deleteTestFromCatalog.bind(labController));

// GET /api/lab/tests/:testId/biomarkers
router.get('/tests/:testId/biomarkers', labController.getBiomarkers.bind(labController));

// POST /api/lab/tests/:testId/biomarkers
router.post('/tests/:testId/biomarkers', labController.updateBiomarkers.bind(labController));

// GET /api/lab/requests/token/:token
router.get('/requests/token/:token', labController.getRequestByToken.bind(labController));

// POST /api/lab/requests
router.post('/requests', labController.createRequest.bind(labController));

// GET /api/lab/requests?status=PENDING
router.get('/requests', labController.getPendingRequests.bind(labController));

// GET /api/lab/reports
router.get('/reports', labController.getPublishedReports.bind(labController));

// POST /api/lab/requests/:requestId/results
router.post('/requests/:requestId/results', labController.submitResults.bind(labController));

// GET /api/lab/metrics
router.get('/metrics', cacheMiddleware(300), labController.getMetrics.bind(labController));

// GET /api/lab/reports/:referenceNo  — public report viewer (no auth required)
router.get('/reports/:referenceNo', labController.getReportByRef.bind(labController));

// POST /api/lab/requests/:requestId/publish  — saves results + SMS + marks COMPLETED
router.post('/requests/:requestId/publish', labController.publishReport.bind(labController));

export default router;
