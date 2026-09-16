import { Router } from 'express';
import { exportArchitectXMI, importArchitectXMI } from '../controllers/architect.controller';
import { exportCanonicalJson, downloadSpringBootZip } from '../controllers/springboot.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/export-xmi', exportArchitectXMI);
router.post('/import-xmi', importArchitectXMI);
router.post('/export-json', exportCanonicalJson);
router.post('/generate-springboot', downloadSpringBootZip);

export default router;

