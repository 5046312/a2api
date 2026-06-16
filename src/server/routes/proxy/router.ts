import type { FastifyInstance } from 'fastify';
import { chatProxyRoutes } from './chat.js';
import { claudeMessagesProxyRoutes } from './messages.js';
import { completionsProxyRoutes } from './completions.js';
import { embeddingsProxyRoutes } from './embeddings.js';
import { filesProxyRoutes } from './files.js';
import { geminiProxyRoutes } from './gemini.js';
import { imagesProxyRoutes } from './images.js';
import { modelsProxyRoutes } from './models.js';
import { responsesProxyRoutes } from './responses.js';
import { searchProxyRoutes } from './search.js';
import { videosProxyRoutes } from './videos.js';

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  await app.register(modelsProxyRoutes);
  await app.register(chatProxyRoutes);
  await app.register(completionsProxyRoutes);
  await app.register(responsesProxyRoutes);
  await app.register(claudeMessagesProxyRoutes);
  await app.register(embeddingsProxyRoutes);
  await app.register(filesProxyRoutes);
  await app.register(imagesProxyRoutes);
  await app.register(geminiProxyRoutes);
  await app.register(searchProxyRoutes);
  await app.register(videosProxyRoutes);
}
