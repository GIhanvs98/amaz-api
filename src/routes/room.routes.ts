import { Router } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import { roomController } from '../controllers/room.controller.js';
import { getRoomSchedules } from '../controllers/admin.controller.js';

const router = Router();

router.use(verifyToken, requireRole(['SUPERADMIN', 'ADMIN', 'RECEPTIONIST']));

router.get('/', roomController.getAllRooms.bind(roomController));
router.post('/', roomController.createRoom.bind(roomController));
router.get('/:id', roomController.getRoomById.bind(roomController));
router.patch('/:id', roomController.updateRoom.bind(roomController));
router.delete('/:id', roomController.deleteRoom.bind(roomController));
router.patch('/:id/status', roomController.updateRoomStatus.bind(roomController));
router.get('/:id/schedules', getRoomSchedules);

export default router;
