import { Router } from 'express';
import { createProject, getUserProjects, getProjectById, addCollaborator, getWorkHistory } from '../controllers/project.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/', createProject);
router.get('/', getUserProjects);
router.get('/:id', getProjectById);
router.post('/:id/collaborators', addCollaborator);
router.get('/:id/work-history', getWorkHistory);

export default router;
