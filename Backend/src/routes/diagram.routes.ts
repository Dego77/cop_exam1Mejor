import { Router } from 'express';
import {
  getDiagramData,
  createNode,
  updateNode,
  deleteNode,
  createConnector,
  updateConnector,
  deleteConnector,
} from '../controllers/diagram.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/:projectId', getDiagramData);
router.post('/nodes', createNode);
router.put('/nodes/:nodeId', updateNode);
router.delete('/nodes/:nodeId', deleteNode);
router.post('/connectors', createConnector);
router.put('/connectors/:connectorId', updateConnector);
router.delete('/connectors/:connectorId', deleteConnector);

export default router;
