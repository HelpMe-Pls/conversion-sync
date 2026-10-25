// The sync log in D1: one row per event_id, so a deal is sent to Meta at most once.

export const SYNC_STATUSES = ["sending", "sent", "failed", "skipped_no_email", "skipped_no_amount", "skipped_too_old"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// A row stuck in 'sending' this long (a crashed attempt) may be claimed again.
const STALE_SENDING_MS = 5 * 60 * 1000;

export interface SyncLog {
  // Atomically takes the right to send: true only for a new deal or a retryable row.
  claim(eventId: string, dealId: string): Promise<boolean>;
  record(eventId: string, dealId: string, status: SyncStatus, detail?: string): Promise<void>;
}

export function d1Log(db: D1Database, now: () => Date = () => new Date()): SyncLog {
  return {
    async claim(eventId, dealId) {
      const at = now();
      const staleBefore = new Date(at.getTime() - STALE_SENDING_MS).toISOString();
      const row = await db
        .prepare(
          `INSERT INTO sync_log (event_id, deal_id, status, updated_at) VALUES (?, ?, 'sending', ?)
           ON CONFLICT(event_id) DO UPDATE SET status = 'sending', detail = NULL, updated_at = excluded.updated_at
           WHERE sync_log.status IN ('failed', 'skipped_no_email', 'skipped_no_amount')
              OR (sync_log.status = 'sending' AND sync_log.updated_at < ?)
           RETURNING event_id`,
        )
        .bind(eventId, dealId, at.toISOString(), staleBefore)
        .first();
      return row !== null;
    },
    async record(eventId, dealId, status, detail) {
      await db
        .prepare(
          `INSERT INTO sync_log (event_id, deal_id, status, detail, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`,
        )
        .bind(eventId, dealId, status, detail ?? null, now().toISOString())
        .run();
    },
  };
}
