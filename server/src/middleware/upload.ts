import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { BadRequestError } from '../lib/errors.js';
import {
  ALLOWED_ATTACHMENT_LABEL,
  ALLOWED_ATTACHMENT_TYPES,
} from '../requests/limits.js';
import {
  fileExtension,
  resolveContentType,
  tempUploadDir,
} from '../requests/attachments.js';

// Multipart handling for request attachments.
//
// Files stream to a temp directory rather than into memory: five 10 MB uploads is
// 50 MB of buffer per concurrent submission, which is a poor trade on the small box
// this is meant to run on. The temp file is validated and then renamed into place,
// which on one filesystem is atomic and free.
//
// Multer's own limits are the first gate — they abort a too-large upload mid-stream
// instead of reading it all and complaining afterwards.

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, tempUploadDir);
  },
  filename(_req, file, callback) {
    // The temp name is generated; the caller's filename is kept only as metadata.
    const extension = fileExtension(file.originalname);
    const suffix = ALLOWED_ATTACHMENT_TYPES.has(extension) ? extension : '';
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
    files: env.MAX_UPLOAD_FILES,
    // Plain-language fields only; nothing here needs a large text part.
    fieldSize: 8 * 1024,
    fields: 20,
  },
  fileFilter(_req, file, callback) {
    try {
      // Rejecting here stops the bytes before they are written. resolveContentType
      // throws for an unknown extension or a type that contradicts it.
      resolveContentType(file.originalname, file.mimetype);
      callback(null, true);
    } catch (err) {
      callback(err as Error);
    }
  },
});

/**
 * Accepts up to MAX_UPLOAD_FILES files under the `attachments` field, translating
 * multer's own errors into the app's 400s so the client gets one consistent shape.
 */
export function uploadAttachments() {
  const handler = upload.array('attachments', env.MAX_UPLOAD_FILES);

  return function attachmentUpload(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    handler(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        next(new BadRequestError(describeMulterError(err)));
        return;
      }
      next(err);
    });
  };
}

function describeMulterError(err: multer.MulterError): string {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE': {
      const megabytes = Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024));
      return `Each attachment must be ${megabytes} MB or smaller.`;
    }
    case 'LIMIT_FILE_COUNT':
      return `Attach up to ${env.MAX_UPLOAD_FILES} files per request.`;
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Send attachments in the "attachments" field.';
    case 'LIMIT_FIELD_VALUE':
      return 'One of the submitted fields is too long.';
    default:
      return `Attachments must be ${ALLOWED_ATTACHMENT_LABEL} files under the size limit.`;
  }
}
