import { Router } from 'express';
import { handleTextPrompt, handlePhotoPrompt, handleVoicePrompt, getAIChatHistory, clearAIChatHistory, handleSupportPrompt, decideAIProposal } from '../controllers/ai.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

router.use(authenticateToken);

router.post('/chat', handleTextPrompt);
router.post('/decide', decideAIProposal);
router.post('/photo', upload.single('photo'), handlePhotoPrompt);
router.post('/voice', upload.single('voice'), handleVoicePrompt);
router.post('/support', handleSupportPrompt);
router.get('/history/:projectId', getAIChatHistory);
router.delete('/history/:projectId', clearAIChatHistory);

export default router;

