import { Blob } from 'node:buffer';
import type { FastifyInstance, FastifyRequest } from 'fastify';

type MultipartAwareFastify = FastifyInstance & {
  __a2apiMultipartParserRegistered?: boolean;
};

export type MultipartFile = {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type MultipartFormData = {
  get(name: string): string | MultipartFile | null;
  entries(): IterableIterator<[string, string | MultipartFile]>;
};

function getContentType(request: FastifyRequest): string {
  return typeof request.headers['content-type'] === 'string'
    ? request.headers['content-type']
    : '';
}

export function ensureMultipartBufferParser(app: FastifyInstance): void {
  const target = app as MultipartAwareFastify;
  if (target.__a2apiMultipartParserRegistered) return;

  app.addContentTypeParser(/^multipart\/form-data(?:;.*)?$/i, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  target.__a2apiMultipartParserRegistered = true;
}

export function isMultipartRequest(request: FastifyRequest): boolean {
  return /^multipart\/form-data(?:;.*)?$/i.test(getContentType(request));
}

export async function parseMultipartFormData(request: FastifyRequest): Promise<MultipartFormData | null> {
  if (!isMultipartRequest(request)) return null;
  const body = request.body;
  if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) return null;

  // 复用 Node 运行时内置 FormData 解析，避免为单个上传入口额外引入 multipart 依赖。
  const runtime = globalThis as typeof globalThis & {
    Response: new (body?: unknown, init?: { headers?: Record<string, string> }) => { formData(): Promise<MultipartFormData> };
  };
  const response = new runtime.Response(new Blob([Buffer.from(body)]), {
    headers: { 'content-type': getContentType(request) }
  });
  return response.formData();
}
