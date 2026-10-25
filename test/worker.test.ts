import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const SECRET = "test-client-secret";
const URL_ = "https://sync.example.com/webhooks/hubspot";

async function signedRequest(body: string): Promise<Request> {
  const ts = String(Date.now());
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`POST${URL_}${body}${ts}`));
  return new Request(URL_, {
    method: "POST",
    body,
    headers: {
      "X-HubSpot-Request-Timestamp": ts,
      "X-HubSpot-Signature-v3": btoa(String.fromCharCode(...new Uint8Array(mac))),
    },
  });
}

// A D1 stand-in that answers the claim query with a row and accepts every write.
function fakeD1(): D1Database {
  const stmt = {
    bind: () => stmt,
    first: async () => ({ event_id: "claimed" }),
    run: async () => ({ success: true }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

const env: Env = {
  DB: fakeD1(),
  HUBSPOT_CLIENT_SECRET: SECRET,
  HUBSPOT_TOKEN: "hs",
  META_PIXEL_ID: "px",
  META_ACCESS_TOKEN: "meta",
  META_API_VERSION: "v21.0",
  WON_STAGES: "closedwon",
  DEFAULT_CURRENCY: "USD",
};

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const won = JSON.stringify([{ subscriptionType: "deal.propertyChange", propertyName: "dealstage", propertyValue: "closedwon", objectId: 7 }]);

function stubApis(metaStatus: number) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/objects/deals/")) {
      return Response.json({
        properties: { amount: "100", closedate: new Date().toISOString() },
        associations: { contacts: { results: [{ id: "c1" }] } },
      });
    }
    if (url.includes("/objects/contacts/")) return Response.json({ properties: { email: "a@b.co" } });
    return new Response("{}", { status: metaStatus });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /webhooks/hubspot", () => {
  it("answers 204 once the sale reached Meta", async () => {
    stubApis(200);
    const res = await worker.fetch(await signedRequest(won), env, ctx);
    expect(res.status).toBe(204);
  });

  it("answers 503 when Meta fails, so HubSpot retries the delivery", async () => {
    stubApis(500);
    const res = await worker.fetch(await signedRequest(won), env, ctx);
    expect(res.status).toBe(503);
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await worker.fetch(new Request(URL_, { method: "POST", body: won }), env, ctx);
    expect(res.status).toBe(401);
  });
});
