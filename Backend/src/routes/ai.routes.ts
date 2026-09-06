import { Router } from 'express';
import { handleTextPrompt, handlePhotoPrompt, handleVoicePrompt, getAIChatHistory } from '../controllers/ai.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/chat', handleTextPrompt);
router.post('/photo', upload.single('photo'), handlePhotoPrompt);
router.post('/voice', upload.single('voice'), handleVoicePrompt);
router.get('/history/:projectId', getAIChatHistory);

export default router;
