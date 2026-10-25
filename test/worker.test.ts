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

// A D1 stand-in. `existing` is the deal's current sync_log status, or null for a new deal:
// the claim upsert returns a row only for a new deal, and the status read returns `existing`.
function fakeD1(existing: string | null = null): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: () => stmt,
        first: async () => (sql.trim().startsWith("INSERT") ? (existing ? null : { event_id: "e" }) : { status: existing }),
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  } as unknown as D1Database;
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

  it("answers 503 while another delivery of the deal is still sending, so HubSpot retries", async () => {
    stubApis(200);
    const res = await worker.fetch(await signedRequest(won), { ...env, DB: fakeD1("sending") }, ctx);
    expect(res.status).toBe(503);
  });

  it("answers 204 for a deal that already went out", async () => {
    stubApis(200);
    const res = await worker.fetch(await signedRequest(won), { ...env, DB: fakeD1("sent") }, ctx);
    expect(res.status).toBe(204);
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await worker.fetch(new Request(URL_, { method: "POST", body: won }), env, ctx);
    expect(res.status).toBe(401);
  });
});

// A D1 stand-in that keeps one sync_log status per (deal, destination) and applies the claim rule:
// a new row or a failed one may be claimed; a sent one may not.
function statefulD1(): D1Database {
  const rows = new Map<string, string>();
  return {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => ((args = a), stmt),
        first: async () => {
          const key = `${args[0]}/${args[1]}`;
          if (sql.trim().startsWith("SELECT")) return rows.has(key) ? { status: rows.get(key) } : null;
          const status = rows.get(key);
          if (status !== undefined && status !== "failed") return null;
          rows.set(key, "sending");
          return { event_id: args[0] };
        },
        run: async () => {
          rows.set(`${args[0]}/${args[1]}`, String(args[3]));
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

// A throwaway service-account key file, made fresh for each run.
async function testOnlyServiceAccountKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ client_email: "test@example-project.iam.gserviceaccount.com", private_key: pem });
}

// HubSpot, Meta and Google faked at the fetch boundary. Returns the hosts each delivery reached.
function stubAllApis(googleStatus: () => number): string[] {
  const hosts: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    hosts.push(url.host);
    if (url.pathname.includes("/objects/deals/")) {
      return Response.json({
        properties: { amount: "100", closedate: new Date().toISOString() },
        associations: { contacts: { results: [{ id: "c1" }] } },
      });
    }
    if (url.pathname.includes("/objects/contacts/")) return Response.json({ properties: { email: "a@b.co" } });
    if (url.host === "graph.facebook.com") return Response.json({ events_received: 1 });
    if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "ya29.test" });
    if (url.host === "datamanager.googleapis.com") return Response.json({ requestId: "r1" }, { status: googleStatus() });
    return new Response("unexpected", { status: 404 });
  });
  return hosts;
}

describe("POST /webhooks/hubspot with Google Ads set up", () => {
  async function googleEnv(): Promise<Env> {
    return {
      ...env,
      DB: statefulD1(),
      GOOGLE_ADS_ACCOUNT_ID: "123-456-7890",
      GOOGLE_CONVERSION_ACTION_ID: "987654321",
      GOOGLE_SERVICE_ACCOUNT_KEY: await testOnlyServiceAccountKey(),
    };
  }

  it("answers 503 when Meta takes the sale and Google fails, and the redelivery sends to Google only", async () => {
    let googleStatus = 500;
    const hosts = stubAllApis(() => googleStatus);
    const e = await googleEnv();

    const first = await worker.fetch(await signedRequest(won), e, ctx);
    expect(first.status).toBe(503);
    expect(hosts).toContain("graph.facebook.com");

    hosts.length = 0;
    googleStatus = 200;
    const retry = await worker.fetch(await signedRequest(won), e, ctx);
    expect(retry.status).toBe(204);
    expect(hosts).toContain("datamanager.googleapis.com");
    expect(hosts).not.toContain("graph.facebook.com");
  });

  it("leaves Google out while any of its three settings is missing", async () => {
    const hosts = stubAllApis(() => 200);
    const { GOOGLE_SERVICE_ACCOUNT_KEY: _missing, ...e } = await googleEnv();

    const res = await worker.fetch(await signedRequest(won), e, ctx);
    expect(res.status).toBe(204);
    expect(hosts).not.toContain("datamanager.googleapis.com");
  });
});

