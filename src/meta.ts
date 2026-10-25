// Meta side: normalize + hash identifiers, build the Purchase event, send it.
import type { WonDeal } from "./hubspot";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Meta wants digits only, with the country code and no leading zeros.
export function normalizePhone(phone: string, defaultCountryCode?: string): string {
  const raw = phone.trim().replace(/\s*(ext\.?|x)\s*\d+$/i, "");
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  const national = digits.replace(/^0+/, "");
  return defaultCountryCode ? `${defaultCountryCode}${national}` : national;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PurchaseEvent {
  event_name: "Purchase";
  event_time: number;
  event_id: string;
  action_source: "system_generated";
  user_data: { em?: string[]; ph?: string[] };
  custom_data: { value: number; currency: string };
}

export function eventIdFor(dealId: string): string {
  return `hubspot-deal-${dealId}`;
}

// The D1 sync log is what stops a repeat send: Meta only matches a server event's event_id
// against a browser Pixel event, never against another server event.
export async function buildPurchaseEvent(
  deal: Omit<WonDeal, "email" | "amount"> & { email: string; amount: number },
  defaultCountryCode?: string,
): Promise<PurchaseEvent> {
  const user_data: PurchaseEvent["user_data"] = { em: [await sha256Hex(normalizeEmail(deal.email))] };
  const phone = deal.phone ? normalizePhone(deal.phone, defaultCountryCode) : "";
  if (phone) user_data.ph = [await sha256Hex(phone)];

  return {
    event_name: "Purchase",
    event_time: Math.floor(deal.closedAt.getTime() / 1000),
    event_id: eventIdFor(deal.dealId),
    action_source: "system_generated",
    user_data,
    custom_data: { value: deal.amount, currency: deal.currency },
  };
}

export interface MetaConfig {
  pixelId: string;
  accessToken: string;
  apiVersion: string;
  testEventCode?: string;
}

export async function sendEvents(events: PurchaseEvent[], cfg: MetaConfig): Promise<void> {
  const body: Record<string, unknown> = { data: events, access_token: cfg.accessToken };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meta CAPI ${res.status}: ${await res.text()}`);
}
