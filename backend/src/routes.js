import { Router } from 'express';
import { reportControllers } from './controllers.js';

export function reportRoutes(reports, registry) {
  const router = Router();
  const controllers = reportControllers(reports, registry);
  router.post('/', controllers.create);
  router.get('/:id', controllers.get);
  router.post('/:id/register', controllers.register);
  router.post('/:id/verify', controllers.verify);
  return router;
}
