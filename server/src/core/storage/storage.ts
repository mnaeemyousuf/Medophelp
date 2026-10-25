import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { BusinessRuleError } from '../errors';

/** Object-storage abstraction. LocalDiskStorage for dev; implement the same interface for S3/Azure Blob. */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDiskStorage implements FileStorage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
}

export const storage: FileStorage = new LocalDiskStorage(env.FILE_STORAGE_DIR);

const SIGNATURES: Array<{ type: string; ext: string[]; magic: number[] }> = [
  { type: 'application/pdf', ext: ['.pdf'], magic: [0x25, 0x50, 0x44, 0x46] },
  { type: 'image/png', ext: ['.png'], magic: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', ext: ['.jpg', '.jpeg'], magic: [0xff, 0xd8, 0xff] },
];

/**
 * Accepts only PDF/PNG/JPEG whose extension, declared type AND leading bytes agree.
 * Returns a safe random storage key; the original name is kept only as metadata.
 */
export function validateUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, folder: string) {
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new BusinessRuleError(`File exceeds ${env.MAX_UPLOAD_MB} MB`);
  const ext = path.extname(file.originalname).toLowerCase();
  const sig = SIGNATURES.find((s) => s.type === file.mimetype && s.ext.includes(ext));
  if (!sig) throw new BusinessRuleError('Only PDF, PNG and JPEG files are allowed');
  if (!sig.magic.every((b, i) => file.buffer[i] === b)) throw new BusinessRuleError('File content does not match its type');
  const safeName = path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  return { key: `${folder}/${crypto.randomUUID()}${ext}`, safeName, contentType: sig.type };
}
