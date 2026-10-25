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
// with a fixed set of percent-escapes in the URI decoded first. Timestamps more than 5 minutes
// away from now are rejected to stop replays.
export async function verifySignatureV3(input: SignatureInput): Promise<boolean> {
  const { secret, method, uri, body, timestamp, signature, now } = input;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_AGE_MS) return false;

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
  const signedUri = uri.replace(/%3A|%2F|%3F|%40|%21|%24|%27|%28|%29|%2A|%2C|%3B/gi, (m) => decodeURIComponent(m));
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, given, new TextEncoder().encode(`${method}${signedUri}${body}${timestamp}`));
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
  amount: number | null;
  currency: string;
  email: string | null;
  phone: string | null;
  // The contact's Google click id, when HubSpot saved one.
  gclid: string | null;
}

const API = "https://api.hubapi.com";

// Reads the deal and its first associated contact with a private-app token
// (scopes: crm.objects.deals.read, crm.objects.contacts.read). `gclidProperty` is the contact
// property that holds the Google click id.
export async function fetchWonDeal(
  dealId: string,
  token: string,
  fallbackCurrency: string,
  gclidProperty = "hs_google_click_id",
): Promise<WonDeal> {
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
  let gclid: string | null = null;
  const contactId = deal.associations?.contacts?.results?.[0]?.id;
  if (contactId) {
    const props = ["email", "phone", gclidProperty].map(encodeURIComponent).join(",");
    const contactRes = await fetch(`${API}/crm/v3/objects/contacts/${contactId}?properties=${props}`, { headers });
    if (!contactRes.ok) throw new Error(`HubSpot contact ${contactId}: ${contactRes.status}`);
    const contact = (await contactRes.json()) as { properties: Record<string, string | null | undefined> };
    email = contact.properties.email || null;
    phone = contact.properties.phone || null;
    gclid = contact.properties[gclidProperty] || null;
  }

  return {
    dealId,
    closedAt: deal.properties.closedate ? new Date(deal.properties.closedate) : new Date(),
    amount: parseAmount(deal.properties.amount),
    currency: deal.properties.deal_currency_code || fallbackCurrency,
    email,
    phone,
    gclid,
  };
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
