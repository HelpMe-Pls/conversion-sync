// Meta side: normalize + hash identifiers, build the Purchase event, send it.
import type { WonDeal } from "./hubspot";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
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

// event_id lets Meta drop duplicates if the same deal is ever sent twice.
export async function buildPurchaseEvent(deal: Omit<WonDeal, "email"> & { email: string }): Promise<PurchaseEvent> {
  const user_data: PurchaseEvent["user_data"] = { em: [await sha256Hex(normalizeEmail(deal.email))] };
  const phone = deal.phone ? normalizePhone(deal.phone) : "";
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
