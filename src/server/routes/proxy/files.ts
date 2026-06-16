import type { FastifyInstance, FastifyReply } from 'fastify';
import { getProxyResourceOwner } from '../../middleware/auth.js';
import { sendError } from '../../shared/errors.js';
import {
  getProxyFileByPublicIdForOwner,
  getProxyFileContentByPublicIdForOwner,
  listProxyFilesByOwner,
  saveProxyFile,
  softDeleteProxyFileByPublicIdForOwner,
  type ProxyFileRecord
} from '../../services/proxyFileService.js';
import { ensureMultipartBufferParser, parseMultipartFormData, type MultipartFile } from './multipart.js';

function toUnixSeconds(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000);
}

function toFileObject(record: ProxyFileRecord) {
  return {
    id: record.publicId,
    object: 'file',
    bytes: record.byteSize,
    created_at: toUnixSeconds(record.createdAt),
    filename: record.filename,
    purpose: record.purpose || 'assistants',
    mime_type: record.mimeType
  };
}

function isMultipartFile(value: unknown): value is MultipartFile {
  return typeof value === 'object'
    && value !== null
    && typeof (value as MultipartFile).arrayBuffer === 'function';
}

function notFound(reply: FastifyReply) {
  return sendError(reply, 404, 'route_not_found', 'file not found', 'file_not_found');
}

export async function filesProxyRoutes(app: FastifyInstance): Promise<void> {
  ensureMultipartBufferParser(app);

  app.post('/v1/files', async (request, reply) => {
    const owner = getProxyResourceOwner(request);
    if (!owner) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');

    const formData = await parseMultipartFormData(request);
    if (!formData) {
      return sendError(reply, 400, 'validation_error', 'multipart/form-data with a file field is required', 'invalid_payload');
    }

    const file = formData.get('file');
    if (!isMultipartFile(file)) {
      return sendError(reply, 400, 'validation_error', 'file field is required', 'invalid_payload');
    }

    const purposeValue = formData.get('purpose');
    const purpose = typeof purposeValue === 'string' && purposeValue.trim()
      ? purposeValue.trim()
      : 'assistants';
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveProxyFile({
      ...owner,
      filename: file.name || 'upload.bin',
      mimeType: file.type || 'application/octet-stream',
      purpose,
      buffer
    });
    return reply.send(toFileObject(saved));
  });

  app.get('/v1/files', async (request, reply) => {
    const owner = getProxyResourceOwner(request);
    if (!owner) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const files = await listProxyFilesByOwner(owner);
    return reply.send({
      object: 'list',
      data: files.map((item) => toFileObject(item)),
      has_more: false
    });
  });

  app.get<{ Params: { fileId: string } }>('/v1/files/:fileId', async (request, reply) => {
    const owner = getProxyResourceOwner(request);
    if (!owner) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const file = await getProxyFileByPublicIdForOwner(request.params.fileId, owner);
    if (!file) return notFound(reply);
    return reply.send(toFileObject(file));
  });

  app.get<{ Params: { fileId: string } }>('/v1/files/:fileId/content', async (request, reply) => {
    const owner = getProxyResourceOwner(request);
    if (!owner) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const file = await getProxyFileContentByPublicIdForOwner(request.params.fileId, owner);
    if (!file) return notFound(reply);
    reply.type(file.mimeType);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    return reply.send(file.buffer);
  });

  app.delete<{ Params: { fileId: string } }>('/v1/files/:fileId', async (request, reply) => {
    const owner = getProxyResourceOwner(request);
    if (!owner) return sendError(reply, 401, 'auth_error', 'Missing proxy auth context', 'missing_proxy_auth');
    const deleted = await softDeleteProxyFileByPublicIdForOwner(request.params.fileId, owner);
    if (!deleted) return notFound(reply);
    return reply.send({
      id: request.params.fileId,
      object: 'file',
      deleted: true
    });
  });
}
