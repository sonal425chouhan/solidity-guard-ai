import express from 'express';
import { AppError } from './errors.js';
import { reportRoutes } from './routes.js';
import { createReportService } from './services/reports.js';
import { createRegistryService } from './services/registry.js';
import { localAccess } from './local-access.js';

export function createApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localAccess);
  // A report can be larger than its source because it contains scanner findings.
  app.use('/api/reports/:id/verify', express.json({ limit: '8mb' }));
  // Escaped JSON can be larger than its decoded 100 KiB source field.
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/reports', reportRoutes(createReportService(options), createRegistryService(options)));
  app.use((_request, response) => {
    response.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });
  app.use((error, _request, response, _next) => {
    const status = error instanceof AppError ? error.status : [400, 413, 415].includes(error.status) ? error.status : 500;
    response.status(status).json({ success: false, error: {
      code: error instanceof AppError ? error.code : status === 500 ? 'INTERNAL_ERROR' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST',
      message: error instanceof AppError ? error.message : status === 500 ? 'An unexpected error occurred.' : status === 415 ? 'Use UTF-8 application/json with a supported content encoding.' : 'Invalid request body.',
    } });
  });
  return app;
}

export const app = createApp();
