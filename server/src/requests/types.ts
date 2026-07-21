// Domain shapes for requests. Input types are derived from the zod schemas in
// schemas.ts; these describe what comes back out of the service layer.

/** Lifecycle of a submission before (and after) a human reviews it. */
export type RequestStatus = 'needs-review' | 'approved' | 'rejected' | 'duplicate';

export interface RequestAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** Where the client can fetch the bytes. Never the on-disk path. */
  url: string;
}

export interface RequestSummary {
  id: string;
  workspaceId: string;
  requesterUserId: string | null;
  requesterName: string;
  description: string;
  location: string;
  contactName: string;
  urgencyNote: string;
  status: RequestStatus;
  duplicateOfTicketId: string | null;
  attachmentCount: number;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RequestDetail extends RequestSummary {
  attachments: RequestAttachment[];
}

export interface RequestPage {
  requests: RequestSummary[];
  /** Opaque keyset cursor for the next page; null when this is the last one. */
  nextCursor: string | null;
}

/** A validated attachment on its way to disk, before the request row exists. */
export interface PendingAttachment {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Absolute path of the temp file multer wrote. */
  tempPath: string;
}
