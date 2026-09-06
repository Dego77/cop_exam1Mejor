import { Router } from 'express';
import { exportArchitectXMI, importArchitectXMI } from '../controllers/architect.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/export-xmi', exportArchitectXMI);
router.post('/import-xmi', importArchitectXMI);

export default router;
