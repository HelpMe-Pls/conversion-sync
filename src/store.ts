// The sync log in D1: one row per event_id, so HubSpot retries never double-send.

export type SyncStatus = "sent" | "failed" | "skipped_no_email";

export interface SyncLog {
  has(eventId: string): Promise<boolean>;
  record(eventId: string, dealId: string, status: SyncStatus, detail?: string): Promise<void>;
}

export function d1Log(db: D1Database): SyncLog {
  return {
    async has(eventId) {
      const row = await db.prepare("SELECT 1 FROM sync_log WHERE event_id = ? AND status = 'sent'").bind(eventId).first();
      return row !== null;
    },
    async record(eventId, dealId, status, detail) {
      await db
        .prepare(
          `INSERT INTO sync_log (event_id, deal_id, status, detail, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`,
        )
        .bind(eventId, dealId, status, detail ?? null, new Date().toISOString())
        .run();
    },
  };
}
