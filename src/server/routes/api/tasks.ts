import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBackgroundTask, listBackgroundTasks } from '../../services/backgroundTaskService.js';
import { sendError } from '../../shared/errors.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const idParamsSchema = z.object({
  id: z.string().trim().min(1)
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tasks', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return { tasks: listBackgroundTasks(query.limit || 50) };
  });

  app.get('/api/tasks/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const task = getBackgroundTask(params.id);
    if (!task) return sendError(reply, 404, 'validation_error', 'Task not found', 'task_not_found');
    return { ok: true, task };
  });
}
