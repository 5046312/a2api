import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const payload = {
    ok: true,
    name: 'a2api'
  };

  app.get('/api/health', async () => payload);
  app.get('/api/desktop/health', async () => payload);
}
