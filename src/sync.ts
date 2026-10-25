// One won deal → one Meta Purchase event, logged once.
import type { WonDeal } from "./hubspot";
import { buildPurchaseEvent, eventIdFor, type PurchaseEvent } from "./meta";
import type { SyncLog } from "./store";

export interface Deps {
  log: SyncLog;
  fetchDeal(dealId: string): Promise<WonDeal>;
  sendToMeta(events: PurchaseEvent[]): Promise<void>;
}

export type SyncResult = "sent" | "duplicate" | "skipped_no_email" | "failed";

export async function syncWonDeal(dealId: string, deps: Deps): Promise<SyncResult> {
  const eventId = eventIdFor(dealId);
  if (await deps.log.has(eventId)) return "duplicate";

  try {
    const deal = await deps.fetchDeal(dealId);
    if (!deal.email) {
      await deps.log.record(eventId, dealId, "skipped_no_email");
      return "skipped_no_email";
    }
    await deps.sendToMeta([await buildPurchaseEvent({ ...deal, email: deal.email })]);
    await deps.log.record(eventId, dealId, "sent");
    return "sent";
  } catch (err) {
    await deps.log.record(eventId, dealId, "failed", err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
