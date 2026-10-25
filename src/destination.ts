// The destination seam: an ad platform that receives won deals. The sync runs every enabled one.
import type { WonDeal } from "./hubspot";

// A won deal that passed the shared checks: it has an email and an amount, and its close date
// is not in the future.
export type SendableDeal = Omit<WonDeal, "email" | "amount"> & { email: string; amount: number };

export interface Destination {
  // The sync-log key for this destination, e.g. "meta". Changing it re-sends every deal.
  name: string;
  // Sales that closed longer ago than this are logged as skipped_too_old for this destination.
  maxAgeMs: number;
  // Sends one won deal; throws on failure (RejectedError when retrying cannot help). May return a detail for the sync log, such as a request id.
  send(deal: SendableDeal): Promise<string | void>;
}

// Thrown by a destination when the platform refused the sale for good (e.g. a click outside its
// window): logged as rejected and never retried, so HubSpot is not asked to redeliver forever.
export class RejectedError extends Error {}

// The conversion id every destination gets for a deal (ADR 0002): Meta's event_id, Google's transactionId.
export function conversionIdFor(dealId: string): string {
  return `hubspot-deal-${dealId}`;
}
