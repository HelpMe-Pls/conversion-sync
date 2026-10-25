// One won deal → one Meta Purchase event, sent at most once.
import type { WonDeal } from "./hubspot";
import { buildPurchaseEvent, eventIdFor, type PurchaseEvent } from "./meta";
import type { SyncLog, SyncStatus } from "./store";

// Meta rejects server events dated more than 7 days back; keep an hour of margin.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

export interface Deps {
  log: SyncLog;
  now(): Date;
  fetchDeal(dealId: string): Promise<WonDeal>;
  sendToMeta(events: PurchaseEvent[]): Promise<void>;
  defaultPhoneCountryCode?: string;
}

export type SyncResult = Exclude<SyncStatus, "sending"> | "duplicate" | "in_flight";

export async function syncWonDeal(dealId: string, deps: Deps): Promise<SyncResult> {
  const eventId = eventIdFor(dealId);
  const claim = await deps.log.claim(eventId, dealId);
  if (claim === "in_flight") return "in_flight";
  if (claim === "done") return "duplicate";

  const finish = async (status: Exclude<SyncResult, "duplicate" | "in_flight">, detail?: string) => {
    await deps.log.record(eventId, dealId, status, detail);
    return status;
  };

  try {
    const deal = await deps.fetchDeal(dealId);
    if (!deal.email) return await finish("skipped_no_email");
    if (deal.amount === null) return await finish("skipped_no_amount");

    const now = deps.now();
    const closed = deal.closedAt.getTime();
    if (now.getTime() - closed > MAX_EVENT_AGE_MS) return await finish("skipped_too_old", deal.closedAt.toISOString());
    // An invalid or future close date is dated now: Meta rejects event times in the future.
    const closedAt = Number.isNaN(closed) || closed > now.getTime() ? now : deal.closedAt;

    const event = await buildPurchaseEvent(
      { ...deal, closedAt, email: deal.email, amount: deal.amount },
      deps.defaultPhoneCountryCode,
    );
    await deps.sendToMeta([event]);
    return await finish("sent");
  } catch (err) {
    return finish("failed", err instanceof Error ? err.message : String(err));
  }
}
