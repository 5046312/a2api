import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { ProxyResourceOwner } from '../middleware/auth.js';
import { nowIso } from '../shared/time.js';

const LOCAL_PROXY_FILE_ID_PREFIX = 'file-a2api-';

export type ProxyFileRecord = {
  publicId: string;
  ownerType: ProxyResourceOwner['ownerType'];
  ownerId: string;
  filename: string;
  mimeType: string;
  purpose: string | null;
  byteSize: number;
  sha256: string;
  contentBase64: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SaveProxyFileInput = ProxyResourceOwner & {
  filename: string;
  mimeType: string;
  purpose?: string | null;
  buffer: Buffer;
};

function buildPublicFileId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${LOCAL_PROXY_FILE_ID_PREFIX}${timePart}-${randomPart}`;
}

function normalizeFilename(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'upload.bin';
}

function normalizeMimeType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'application/octet-stream';
}

function rowToRecord(row: typeof schema.proxyFiles.$inferSelect): ProxyFileRecord {
  return {
    publicId: row.publicId,
    ownerType: row.ownerType as ProxyResourceOwner['ownerType'],
    ownerId: row.ownerId,
    filename: row.filename,
    mimeType: row.mimeType,
    purpose: row.purpose,
    byteSize: row.byteSize,
    sha256: row.sha256,
    contentBase64: row.contentBase64,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt
  };
}

function ownerWhere(owner: ProxyResourceOwner) {
  return and(
    eq(schema.proxyFiles.ownerType, owner.ownerType),
    eq(schema.proxyFiles.ownerId, owner.ownerId)
  );
}

export async function saveProxyFile(input: SaveProxyFileInput): Promise<ProxyFileRecord> {
  const now = nowIso();
  const publicId = buildPublicFileId();
  const filename = normalizeFilename(input.filename);
  const mimeType = normalizeMimeType(input.mimeType);
  const contentBase64 = input.buffer.toString('base64');
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');

  await db.insert(schema.proxyFiles).values({
    publicId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    filename,
    mimeType,
    purpose: input.purpose?.trim() || null,
    byteSize: input.buffer.byteLength,
    sha256,
    contentBase64,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }).run();

  const saved = await getProxyFileByPublicIdForOwner(publicId, input);
  if (!saved) throw new Error('Saved proxy file was not found');
  return saved;
}

export async function listProxyFilesByOwner(owner: ProxyResourceOwner): Promise<ProxyFileRecord[]> {
  const rows = await db
    .select()
    .from(schema.proxyFiles)
    .where(and(ownerWhere(owner), isNull(schema.proxyFiles.deletedAt)))
    .orderBy(desc(schema.proxyFiles.createdAt))
    .all();
  return rows.map(rowToRecord);
}

export async function getProxyFileByPublicIdForOwner(
  publicId: string,
  owner: ProxyResourceOwner
): Promise<ProxyFileRecord | null> {
  const row = await db
    .select()
    .from(schema.proxyFiles)
    .where(and(
      eq(schema.proxyFiles.publicId, publicId),
      ownerWhere(owner),
      isNull(schema.proxyFiles.deletedAt)
    ))
    .get();
  return row ? rowToRecord(row) : null;
}

export async function getProxyFileContentByPublicIdForOwner(
  publicId: string,
  owner: ProxyResourceOwner
): Promise<{ filename: string; mimeType: string; buffer: Buffer } | null> {
  const record = await getProxyFileByPublicIdForOwner(publicId, owner);
  if (!record) return null;
  return {
    filename: record.filename,
    mimeType: record.mimeType,
    buffer: Buffer.from(record.contentBase64, 'base64')
  };
}

export async function softDeleteProxyFileByPublicIdForOwner(
  publicId: string,
  owner: ProxyResourceOwner
): Promise<boolean> {
  const now = nowIso();
  const result = await db
    .update(schema.proxyFiles)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(
      eq(schema.proxyFiles.publicId, publicId),
      ownerWhere(owner),
      or(isNull(schema.proxyFiles.deletedAt), eq(schema.proxyFiles.deletedAt, ''))
    ))
    .run();
  return Number(result.changes || 0) > 0;
}
