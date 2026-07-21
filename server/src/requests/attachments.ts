import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadRoot } from '../config/env.js';
import { BadRequestError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  ALLOWED_ATTACHMENT_LABEL,
  ALLOWED_ATTACHMENT_TYPES,
  TOLERATED_CONTENT_TYPES,
} from './limits.js';

// Attachment handling: what we accept, what we call it, and where it lands on disk.
//
// Two rules drive the whole file. First, an uploaded file's own claims — its name and
// its declared content type — are treated as hostile input, never as facts: the stored
// content type comes from our allow-list and the on-disk name is a UUID, so a crafted
// filename cannot influence the path. Second, the declared type has to match the
// bytes, because "shell.sh renamed to invoice.pdf" is the oldest trick there is.

/** What a client sends when it has no idea what the file is. */
const UNKNOWN_TYPE = 'application/octet-stream';

/** Lowercased extension including the dot, or '' when there isn't one. */
export function fileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

/**
 * Reduces a user-supplied filename to something safe to show and to log. This is a
 * display name only — it never becomes part of a path — but it still gets stripped of
 * separators and control characters so it can't forge a path in a log line or a
 * Content-Disposition header.
 */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name.trim());
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 120);
  return cleaned || 'attachment';
}

/**
 * Resolves the content type to store. The upload's own header is accepted only when it
 * agrees with the extension (or is a known browser quirk); otherwise the canonical
 * type for the extension wins. Unknown extensions are rejected outright.
 */
export function resolveContentType(
  fileName: string,
  declared: string | undefined,
): string {
  const extension = fileExtension(fileName);
  const canonical = ALLOWED_ATTACHMENT_TYPES.get(extension);
  if (!canonical) {
    throw new BadRequestError(
      `Attachments must be ${ALLOWED_ATTACHMENT_LABEL} files.`,
    );
  }

  const normalized = declared?.split(';')[0]?.trim().toLowerCase() ?? '';
  // application/octet-stream is a client saying "I don't know what this is" — an
  // absence of information, not a claim that contradicts the extension. curl sends it
  // for anything it can't guess, and rejecting it would fail ordinary uploads.
  if (!normalized || normalized === canonical || normalized === UNKNOWN_TYPE) {
    return canonical;
  }

  const tolerated = TOLERATED_CONTENT_TYPES.get(extension) ?? [];
  if (tolerated.includes(normalized)) return canonical;

  throw new BadRequestError(
    `${sanitizeFileName(fileName)} does not match an allowed file type.`,
  );
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks a file's leading bytes against the signature its extension implies. `bytes`
 * is the head of the file (a few KB is plenty); text formats are validated by being
 * decodable UTF-8 rather than by a magic number, since they don't have one.
 *
 * A truncated multi-byte character at the read boundary would make a perfectly valid
 * UTF-8 file look invalid, so text checks only run on a complete read.
 */
export function matchesSignature(
  extension: string,
  bytes: Uint8Array,
  isCompleteFile: boolean,
): boolean {
  const ascii = new TextDecoder('latin1').decode(bytes);

  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case '.png':
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.webp':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case '.pdf':
      return ascii.startsWith('%PDF-');
    // DOCX is a zip container; the local file header is the only reliable marker.
    case '.docx':
      return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case '.txt':
    case '.csv':
    case '.json':
      return isCompleteFile ? isUtf8(bytes) : true;
    default:
      return false;
  }
}

const SIGNATURE_READ_BYTES = 4096;

/**
 * Reads the head of an uploaded temp file and rejects it when the bytes contradict the
 * extension. JSON gets a parse on top: a file that claims to be JSON and isn't will
 * break whatever reads it later, and here is the cheapest place to find that out.
 */
export async function assertSignatureMatches(
  tempPath: string,
  fileName: string,
  sizeBytes: number,
): Promise<void> {
  const extension = fileExtension(fileName);
  const handle = await fs.open(tempPath, 'r');
  let bytes: Uint8Array;
  try {
    const buffer = Buffer.alloc(Math.min(sizeBytes, SIGNATURE_READ_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    bytes = new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }

  const complete = sizeBytes <= SIGNATURE_READ_BYTES;
  if (!matchesSignature(extension, bytes, complete)) {
    throw new BadRequestError(
      `${sanitizeFileName(fileName)} does not match its declared file type.`,
    );
  }

  if (extension === '.json') {
    try {
      JSON.parse(await fs.readFile(tempPath, 'utf8'));
    } catch {
      throw new BadRequestError(
        `${sanitizeFileName(fileName)} must contain valid JSON.`,
      );
    }
  }
}

/** Directory multer streams incoming files into before they are validated. */
export const tempUploadDir = path.join(uploadRoot, 'tmp');

/** Creates the upload directories. Called once at startup. */
export async function ensureUploadDirs(): Promise<void> {
  await fs.mkdir(tempUploadDir, { recursive: true });
}

/**
 * Storage path for a stored attachment, relative to UPLOAD_DIR. The filename is a
 * generated UUID plus the validated extension — no part of it comes from the caller,
 * so directory traversal isn't something this has to defend against, it's something
 * it makes unrepresentable.
 */
export function storagePathFor(
  workspaceId: string,
  requestId: string,
  fileName: string,
): string {
  const extension = fileExtension(fileName);
  return path.posix.join(
    workspaceId,
    requestId,
    `${randomUUID()}${ALLOWED_ATTACHMENT_TYPES.has(extension) ? extension : ''}`,
  );
}

/**
 * Resolves a stored relative path to an absolute one, refusing anything that escapes
 * the upload root. Paths are generated by storagePathFor and never by a user, so this
 * is a backstop against a corrupted or hand-edited database row — cheap, and the kind
 * of check that matters precisely when an assumption has already been broken.
 */
export function resolveStoragePath(storagePath: string): string {
  const absolute = path.resolve(uploadRoot, storagePath);
  const root = path.resolve(uploadRoot);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new BadRequestError('Attachment is not available.');
  }
  return absolute;
}

/** Moves a validated temp file to its final location, creating the directory. */
export async function commitAttachment(
  tempPath: string,
  storagePath: string,
): Promise<void> {
  const absolute = resolveStoragePath(storagePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.rename(tempPath, absolute);
}

/**
 * Best-effort cleanup of files left behind by a failed submission. Never throws: this
 * runs on the error path, and an orphaned temp file is a smaller problem than an
 * error handler that itself explodes.
 */
export async function discardFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(
    paths.map(async (target) => {
      try {
        await fs.rm(target, { force: true });
      } catch (err) {
        logger.warn({ err, target }, 'Failed to clean up upload');
      }
    }),
  );
}
