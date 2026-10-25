// One won deal → each enabled destination gets it at most once, tracked per destination.
import { conversionIdFor, type Destination } from "./destination";
import type { WonDeal } from "./hubspot";
import type { SyncLog, SyncStatus } from "./store";

export interface Deps {
  log: SyncLog;
  now(): Date;
  fetchDeal(dealId: string): Promise<WonDeal>;
  destinations: Destination[];
}

export type SyncResult = Exclude<SyncStatus, "sending"> | "duplicate" | "in_flight";
// One result per destination, keyed by destination name.
export type DealSyncResult = Record<string, SyncResult>;

export async function syncWonDeal(dealId: string, deps: Deps): Promise<DealSyncResult> {
  const eventId = conversionIdFor(dealId);
  const results: DealSyncResult = {};

  const claimed: Destination[] = [];
  for (const dest of deps.destinations) {
    const claim = await deps.log.claim(eventId, dealId, dest.name);
    if (claim === "claimed") claimed.push(dest);
    else results[dest.name] = claim === "in_flight" ? "in_flight" : "duplicate";
  }
  if (claimed.length === 0) return results;

  const finish = async (dest: Destination, status: Exclude<SyncResult, "duplicate" | "in_flight">, detail?: string) => {
    await deps.log.record(eventId, dealId, dest.name, status, detail);
    results[dest.name] = status;
  };
  const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let deal: WonDeal;
  try {
    deal = await deps.fetchDeal(dealId);
  } catch (err) {
    await Promise.all(claimed.map((dest) => finish(dest, "failed", reason(err))));
    return results;
  }

  const now = deps.now();
  const closed = deal.closedAt.getTime();
  // An invalid or future close date is dated now: platforms reject event times in the future.
  const closedAt = Number.isNaN(closed) || closed > now.getTime() ? now : deal.closedAt;

  await Promise.all(
    claimed.map(async (dest) => {
      try {
        if (!deal.email) return await finish(dest, "skipped_no_email");
        if (deal.amount === null) return await finish(dest, "skipped_no_amount");
        if (now.getTime() - closed > dest.maxAgeMs) return await finish(dest, "skipped_too_old", deal.closedAt.toISOString());
        const detail = await dest.send({ ...deal, closedAt, email: deal.email, amount: deal.amount });
        await finish(dest, "sent", detail || undefined);
      } catch (err) {
        await finish(dest, "failed", reason(err));
      }
    }),
  );
  return results;
}
