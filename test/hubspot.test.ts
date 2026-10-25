import { describe, expect, it } from "vitest";
import { verifySignatureV3, wonDealIds } from "../src/hubspot";

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
