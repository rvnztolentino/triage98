import { redis } from '../redis/client.js';
import { logger } from '../lib/logger.js';

// The producer half of the triage queue. A submitted request is pushed onto a Redis
// list; the worker added in feat/triage-worker pops from the other end with BRPOP.
//
// The one rule that matters here: enqueueing must never fail a submission. Local
// inference is the optional part of this system — a request that was saved but not
// queued still shows up in the review queue for a human, which is the fallback the
// whole design leans on. So this logs and returns instead of throwing, and callers
// deliberately do not await it as part of their transaction.

/** Redis list holding pending triage jobs. LPUSH here, BRPOP in the worker. */
export const TRIAGE_QUEUE_KEY = 'triage98:triage:jobs';

export interface TriageJob {
  workspaceId: string;
  requestId: string;
  /** Set when the job is created, so the worker can measure queue latency. */
  enqueuedAt: string;
  /** Incremented by the worker on retry; the producer always starts at 0. */
  attempt: number;
}

/**
 * Queues a request for AI triage. Returns true when the job was accepted, false when
 * Redis was unavailable — the caller carries on either way.
 */
export async function enqueueTriageJob(
  workspaceId: string,
  requestId: string,
): Promise<boolean> {
  const job: TriageJob = {
    workspaceId,
    requestId,
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
  };

  // Buffered commands can hang while disconnected (maxRetriesPerRequest: null), so
  // only push when the connection is actually ready.
  if (redis.status !== 'ready') {
    logger.warn(
      { requestId, workspaceId },
      'Redis unavailable; request saved without queuing triage',
    );
    return false;
  }

  try {
    await redis.lpush(TRIAGE_QUEUE_KEY, JSON.stringify(job));
    return true;
  } catch (err) {
    logger.warn(
      { err, requestId, workspaceId },
      'Failed to enqueue triage job; request saved for manual triage',
    );
    return false;
  }
}

/** Current queue depth. Exposed for the health endpoint and the worker's logging. */
export async function triageQueueDepth(): Promise<number | null> {
  if (redis.status !== 'ready') return null;
  try {
    return await redis.llen(TRIAGE_QUEUE_KEY);
  } catch (err) {
    logger.warn({ err }, 'Failed to read triage queue depth');
    return null;
  }
}
