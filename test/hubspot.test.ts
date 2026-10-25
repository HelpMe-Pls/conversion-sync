import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWonDeal, verifySignatureV3, wonDealIds } from "../src/hubspot";

const SECRET = "test-client-secret";

async function sign(source: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(source));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

describe("verifySignatureV3", () => {
  const uri = "https://sync.example.com/webhooks/hubspot";
  const body = '[{"objectId":1}]';
  const now = 1_800_000_000_000;

  it("accepts a fresh, correctly signed request", async () => {
    const ts = String(now - 1000);
    const signature = await sign(`POST${uri}${body}${ts}`);
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri, body, timestamp: ts, signature, now })).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const ts = String(now);
    const signature = await sign(`POST${uri}${body}${ts}`);
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri, body: "[]", timestamp: ts, signature, now })).toBe(false);
  });

  it("rejects a request older than 5 minutes (replay)", async () => {
    const ts = String(now - 5 * 60 * 1000 - 1);
    const signature = await sign(`POST${uri}${body}${ts}`);
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri, body, timestamp: ts, signature, now })).toBe(false);
  });

  it("decodes the escapes HubSpot decodes before signing a URI with a query string", async () => {
    const ts = String(now);
    const signature = await sign(`POSThttps://sync.example.com/webhooks/hubspot?k=a:b${body}${ts}`);
    const encoded = "https://sync.example.com/webhooks/hubspot?k=a%3Ab";
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri: encoded, body, timestamp: ts, signature, now })).toBe(true);
  });

  it("rejects a timestamp from the future", async () => {
    const ts = String(now + 10 * 60 * 1000);
    const signature = await sign(`POST${uri}${body}${ts}`);
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri, body, timestamp: ts, signature, now })).toBe(false);
  });

  it("rejects missing headers", async () => {
    expect(await verifySignatureV3({ secret: SECRET, method: "POST", uri, body, timestamp: null, signature: null, now })).toBe(false);
  });
});

describe("wonDealIds", () => {
  it("keeps only dealstage changes into a won stage, once per deal", () => {
    const events = [
      { subscriptionType: "deal.propertyChange", propertyName: "dealstage", propertyValue: "closedwon", objectId: 11 },
      { subscriptionType: "deal.propertyChange", propertyName: "dealstage", propertyValue: "closedwon", objectId: 11 },
      { subscriptionType: "deal.propertyChange", propertyName: "dealstage", propertyValue: "qualifiedtobuy", objectId: 12 },
      { subscriptionType: "deal.propertyChange", propertyName: "amount", propertyValue: "500", objectId: 13 },
      { subscriptionType: "contact.creation", objectId: 14 },
    ];
    expect(wonDealIds(events, ["closedwon"])).toEqual(["11"]);
  });
});

describe("fetchWonDeal", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(deal: object, contact: object | null) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/objects/deals/")) return Response.json(deal);
      if (url.includes("/objects/contacts/") && contact) return Response.json(contact);
      return new Response("not found", { status: 404 });
    });
  }

  it("reads amount, close date, currency and the contact's email and phone", async () => {
    stub(
      {
        properties: { amount: "1250.50", closedate: "2026-10-25T12:00:00Z", deal_currency_code: "EUR" },
        associations: { contacts: { results: [{ id: "c1" }] } },
      },
      { properties: { email: "jane@example.com", phone: "+1 555 010 9999" } },
    );
    expect(await fetchWonDeal("11", "token", "USD")).toEqual({
      dealId: "11",
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 1250.5,
      currency: "EUR",
      email: "jane@example.com",
      phone: "+1 555 010 9999",
    });
  });

  it("reports a missing amount as null, never as 0", async () => {
    stub({ properties: { amount: null, closedate: "2026-10-25T12:00:00Z" }, associations: {} }, null);
    const deal = await fetchWonDeal("12", "token", "USD");
    expect(deal.amount).toBeNull();
    expect(deal.currency).toBe("USD");
    expect(deal.email).toBeNull();
  });

  it("throws when HubSpot refuses the deal read", async () => {
    stub({}, null);
    vi.stubGlobal("fetch", async () => new Response("rate limited", { status: 429 }));
    await expect(fetchWonDeal("13", "token", "USD")).rejects.toThrow("429");
  });
});
