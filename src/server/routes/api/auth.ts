import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { maskSecret } from '../../shared/mask.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/check', async () => ({
    ok: true,
    tokenMasked: maskSecret(config.authToken)
  }));

  app.get('/api/settings/auth/info', async () => ({
    masked: maskSecret(config.authToken)
  }));
}
