import { Router } from 'express';
import { generatePostgreSQLScript } from '../controllers/sql.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/generate', generatePostgreSQLScript);

export default router;
