import { AppError } from './errors.js';

function requireJson(request) {
  if (!request.is('application/json')) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
}

export function reportControllers(reports, registry) {
  return {
    async create(request, response) {
      requireJson(request);
      const report = await reports.create(request.body);
      response.location(`/api/reports/${report.payload.reportId}`).status(201).json({ success: true, data: report });
    },
    async get(request, response) {
      const report = await reports.get(request.params.id);
      response.set('Cache-Control', 'no-store').json({ success: true, data: report });
    },
    async register(request, response) {
      requireJson(request);
      const result = await registry.register(request.params.id, request.body);
      response.status(result.status === 'unavailable' ? 503 : 200).json({ success: result.status !== 'unavailable', data: result });
    },
    async verify(request, response) {
      requireJson(request);
      const result = await registry.verify(request.params.id, request.body);
      response.set('Cache-Control', 'no-store').status(result.status === 'unavailable' ? 503 : 200)
        .json({ success: result.status !== 'unavailable', data: result });
    },
  };
}
