// The sync log in D1: one row per (event_id, destination), so each destination gets a deal at most once.

export const SYNC_STATUSES = ["sending", "sent", "failed", "skipped_no_email", "skipped_no_amount", "skipped_too_old"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// A row stuck in 'sending' this long (a crashed attempt) may be claimed again.
const STALE_SENDING_MS = 5 * 60 * 1000;

// claimed = this caller may send; in_flight = another attempt is sending it now;
// done = it was sent, or skipped for a reason a retry cannot fix.
export type Claim = "claimed" | "in_flight" | "done";

export interface SyncLog {
  // Atomically takes the right to send to one destination: "claimed" only for a new
  // (deal, destination) or a retryable row.
  claim(eventId: string, dealId: string, destination: string): Promise<Claim>;
  record(eventId: string, dealId: string, destination: string, status: SyncStatus, detail?: string): Promise<void>;
}

export function d1Log(db: D1Database, now: () => Date = () => new Date()): SyncLog {
  return {
    async claim(eventId, dealId, destination) {
      const at = now();
      const staleBefore = new Date(at.getTime() - STALE_SENDING_MS).toISOString();
      const row = await db
        .prepare(
          `INSERT INTO sync_log (event_id, destination, deal_id, status, updated_at) VALUES (?, ?, ?, 'sending', ?)
           ON CONFLICT(event_id, destination) DO UPDATE SET status = 'sending', detail = NULL, updated_at = excluded.updated_at
           WHERE sync_log.status IN ('failed', 'skipped_no_email', 'skipped_no_amount')
              OR (sync_log.status = 'sending' AND sync_log.updated_at < ?)
           RETURNING event_id`,
        )
        .bind(eventId, destination, dealId, at.toISOString(), staleBefore)
        .first();
      if (row !== null) return "claimed";
      const current = await db
        .prepare("SELECT status FROM sync_log WHERE event_id = ? AND destination = ?")
        .bind(eventId, destination)
        .first<{ status: SyncStatus }>();
      return current?.status === "sending" ? "in_flight" : "done";
    },
    async record(eventId, dealId, destination, status, detail) {
      await db
        .prepare(
          `INSERT INTO sync_log (event_id, destination, deal_id, status, detail, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id, destination) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`,
        )
        .bind(eventId, destination, dealId, status, detail ?? null, now().toISOString())
        .run();
    },
  };
}
