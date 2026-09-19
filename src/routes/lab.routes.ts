import { Router } from 'express';
import { labController } from '../controllers/lab.controller';

const router = Router();

// GET /api/lab/upload-url
router.get('/upload-url', labController.getUploadUrl.bind(labController));

// GET /api/lab/queue
router.get('/queue', labController.getQueueTokens.bind(labController));

// GET /api/lab/catalog
router.get('/catalog', labController.getCatalog.bind(labController));

// POST /api/lab/catalog
router.post('/catalog', labController.addTestToCatalog.bind(labController));

// POST /api/lab/requests
router.post('/requests', labController.createRequest.bind(labController));

// GET /api/lab/requests?status=PENDING
router.get('/requests', labController.getPendingRequests.bind(labController));

// GET /api/lab/reports
router.get('/reports', labController.getPublishedReports.bind(labController));

// POST /api/lab/requests/:requestId/results
router.post('/requests/:requestId/results', labController.submitResults.bind(labController));

// GET /api/lab/metrics
router.get('/metrics', labController.getMetrics.bind(labController));

export default router;
