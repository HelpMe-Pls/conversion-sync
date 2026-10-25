// HubSpot side: verify the webhook, pick out won deals, read the deal + its contact.

const MAX_AGE_MS = 5 * 60 * 1000;

export interface SignatureInput {
  secret: string;
  method: string;
  uri: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now: number;
}

// HubSpot signature v3: base64(HMAC-SHA256(clientSecret, method + uri + body + timestamp)),
// and requests older than 5 minutes are rejected to stop replays.
export async function verifySignatureV3(input: SignatureInput): Promise<boolean> {
  const { secret, method, uri, body, timestamp, signature, now } = input;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || now - ts > MAX_AGE_MS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let given: Uint8Array;
  try {
    given = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, given, new TextEncoder().encode(`${method}${uri}${body}${timestamp}`));
}

export interface WebhookEvent {
  subscriptionType?: string;
  propertyName?: string;
  propertyValue?: string;
  objectId?: number | string;
}

export function wonDealIds(events: WebhookEvent[], wonStages: string[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    if (
      e.subscriptionType === "deal.propertyChange" &&
      e.propertyName === "dealstage" &&
      e.propertyValue !== undefined &&
      wonStages.includes(e.propertyValue) &&
      e.objectId !== undefined
    ) {
      ids.add(String(e.objectId));
    }
  }
  return [...ids];
}

export interface WonDeal {
  dealId: string;
  closedAt: Date;
  amount: number;
  currency: string;
  email: string | null;
  phone: string | null;
}

const API = "https://api.hubapi.com";

// Reads the deal and its first associated contact with a private-app token
// (scopes: crm.objects.deals.read, crm.objects.contacts.read).
export async function fetchWonDeal(dealId: string, token: string, fallbackCurrency: string): Promise<WonDeal> {
  const headers = { Authorization: `Bearer ${token}` };
  const dealRes = await fetch(
    `${API}/crm/v3/objects/deals/${dealId}?properties=amount,closedate,deal_currency_code&associations=contacts`,
    { headers },
  );
  if (!dealRes.ok) throw new Error(`HubSpot deal ${dealId}: ${dealRes.status}`);
  const deal = (await dealRes.json()) as {
    properties: { amount?: string | null; closedate?: string | null; deal_currency_code?: string | null };
    associations?: { contacts?: { results?: { id: string }[] } };
  };

  let email: string | null = null;
  let phone: string | null = null;
  const contactId = deal.associations?.contacts?.results?.[0]?.id;
  if (contactId) {
    const contactRes = await fetch(`${API}/crm/v3/objects/contacts/${contactId}?properties=email,phone`, { headers });
    if (!contactRes.ok) throw new Error(`HubSpot contact ${contactId}: ${contactRes.status}`);
    const contact = (await contactRes.json()) as { properties: { email?: string | null; phone?: string | null } };
    email = contact.properties.email || null;
    phone = contact.properties.phone || null;
  }

  return {
    dealId,
    closedAt: deal.properties.closedate ? new Date(deal.properties.closedate) : new Date(),
    amount: Number(deal.properties.amount ?? 0) || 0,
    currency: deal.properties.deal_currency_code || fallbackCurrency,
    email,
    phone,
  };
}
