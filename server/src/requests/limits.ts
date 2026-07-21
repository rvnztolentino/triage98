// Submission caps and the allow-list of attachment types. Same reasoning as
// workspaces/limits.ts: this runs on someone's laptop, so every unbounded input is a
// footgun. The file-type list is an allow-list on purpose — anything not named here
// is rejected rather than sniffed and hoped for.

/** Prefix and starting number for human-readable request ids (REQ-1001, …). */
export const REQUEST_ID_PREFIX = 'REQ';
export const REQUEST_ID_START = 1000;

/** Page size for request listings, and the ceiling a caller may ask for. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Extensions we accept, mapped to the content type they must declare. Browsers are
 * inconsistent about a few of these (notably CSV), so the route treats the mapped
 * value as canonical and stores it rather than trusting the upload's own header.
 */
export const ALLOWED_ATTACHMENT_TYPES = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.pdf', 'application/pdf'],
  [
    '.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
]);

/** Human-readable list for error messages, so the client never has to guess. */
export const ALLOWED_ATTACHMENT_LABEL =
  'JPG, PNG, WebP, PDF, DOCX, TXT, CSV, or JSON';

/**
 * Content types a client may legitimately send for an allowed extension even though
 * they differ from the canonical one above — Excel claims ownership of .csv, and text
 * formats get labelled text/plain by more or less everything.
 *
 * A blank or application/octet-stream declaration is handled separately: that is a
 * client admitting it doesn't know, which isn't a contradiction to resolve here.
 */
export const TOLERATED_CONTENT_TYPES = new Map<string, readonly string[]>([
  ['.csv', ['application/vnd.ms-excel', 'text/plain']],
  ['.json', ['text/plain']],
]);
