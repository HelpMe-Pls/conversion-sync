import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { googleDestination, type GoogleConfig } from "../src/google";
import type { SendableDeal } from "../src/destination";
import { syncWonDeal } from "../src/sync";

// A throwaway RSA key made fresh for each run, so no private key is ever committed.
// The service-account key file mimics the JSON Google issues.
let testKeyFile = "";
let testPublicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n");
  testKeyFile = JSON.stringify({
    type: "service_account",
    client_email: "conversion-sync-test@example-project.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  });
  testPublicKey = pair.publicKey;
});

// base64url of {"alg":"RS256","typ":"JWT"} and of
// {"iss":"conversion-sync-test@example-project.iam.gserviceaccount.com","scope":"https://www.googleapis.com/auth/datamanager",
//  "aud":"https://oauth2.googleapis.com/token","iat":1792929600,"exp":1792933200}, produced independently with
// `openssl base64 -A | tr '+/' '-_' | tr -d '='`.
const EXPECTED_JWT_HEADER = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9";
const EXPECTED_JWT_PAYLOAD =
  "eyJpc3MiOiJjb252ZXJzaW9uLXN5bmMtdGVzdEBleGFtcGxlLXByb2plY3QuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJzY29wZSI6Imh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL2F1dGgvZGF0YW1hbmFnZXIiLCJhdWQiOiJodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbiIsImlhdCI6MTc5MjkyOTYwMCwiZXhwIjoxNzkyOTMzMjAwfQ";

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Literal SHA-256 digests, computed independently with `shasum -a 256`.
const JANE = "8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d"; // jane@example.com
const PHONE_E164 = "d6793cafee143dab64595a0d6ef1f17cd3e7e39c1b87fdd338410e4c71cc4aaf"; // +15550109999

const NOW = new Date("2026-10-25T12:00:00Z"); // 1792929600 in Unix seconds

function config(): GoogleConfig {
  return { accountId: "123-456-7890", conversionActionId: "987654321", serviceAccountKey: testKeyFile, now: () => NOW };
}

const deal: SendableDeal = {
  dealId: "11",
  closedAt: new Date("2026-10-25T10:00:00Z"),
  amount: 1250.5,
  currency: "EUR",
  email: " Jane@Example.com",
  phone: "+1 555 010 9999",
  gclid: "Cj0KCQjw-TestClickId",
};

interface Call {
  url: string;
  init: RequestInit;
}

// Google's two endpoints, faked at the fetch boundary. `ingest` sets the Data Manager answer.
function stubGoogle(ingest: () => Response = () => Response.json({ requestId: "req-123" })): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "ya29.test-token", expires_in: 3599 });
    if (url === "https://datamanager.googleapis.com/v1/events:ingest") return ingest();
    return new Response("unexpected", { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("googleDestination", () => {
  it("trades an RS256-signed service-account JWT for an access token", async () => {
    const calls = stubGoogle();
    await googleDestination(config()).send(deal);

    const token = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    expect(token?.init.method).toBe("POST");
    expect(new Headers(token?.init.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(token?.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, payload, signature] = String(form.get("assertion")).split(".");
    expect(header).toBe(EXPECTED_JWT_HEADER);
    expect(payload).toBe(EXPECTED_JWT_PAYLOAD);
    const signed = new TextEncoder().encode(`${header}.${payload}`);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", testPublicKey, fromBase64Url(signature), signed)).toBe(true);
  });

  it("sends the sale to Data Manager as one HEX-hashed conversion event with the access token", async () => {
    const calls = stubGoogle();
    await googleDestination(config()).send(deal);

    const ingest = calls.find((c) => c.url === "https://datamanager.googleapis.com/v1/events:ingest");
    expect(ingest?.init.method).toBe("POST");
    expect(new Headers(ingest?.init.headers).get("Authorization")).toBe("Bearer ya29.test-token");
    expect(JSON.parse(String(ingest?.init.body))).toEqual({
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          productDestinationId: "987654321",
        },
      ],
      encoding: "HEX",
      events: [
        {
          transactionId: "hubspot-deal-11",
          eventTimestamp: "2026-10-25T10:00:00Z",
          eventSource: "WEB",
          conversionValue: 1250.5,
          currency: "EUR",
          adIdentifiers: { gclid: "Cj0KCQjw-TestClickId" },
          userData: { userIdentifiers: [{ emailAddress: JANE }, { phoneNumber: PHONE_E164 }] },
        },
      ],
    });
  });

  it("adds the login account when the service account sits on a manager account", async () => {
    const calls = stubGoogle();
    await googleDestination({ ...config(), loginAccountId: "111-222-3333" }).send(deal);

    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("events:ingest"))?.init.body));
    expect(body.destinations[0].loginAccount).toEqual({ accountType: "GOOGLE_ADS", accountId: "1112223333" });
  });

  it("matches by hashed email alone when the contact has no gclid and no phone", async () => {
    const calls = stubGoogle();
    await googleDestination(config()).send({ ...deal, gclid: null, phone: null });

    const [event] = JSON.parse(String(calls.find((c) => c.url.endsWith("events:ingest"))?.init.body)).events;
    expect(event.adIdentifiers).toBeUndefined();
    expect(event.userData).toEqual({ userIdentifiers: [{ emailAddress: JANE }] });
  });

  it("puts a + before the country code of a phone saved without one", async () => {
    const calls = stubGoogle();
    await googleDestination({ ...config(), defaultPhoneCountryCode: "1" }).send({ ...deal, phone: "(555) 010-9999" });

    const [event] = JSON.parse(String(calls.find((c) => c.url.endsWith("events:ingest"))?.init.body)).events;
    expect(event.userData.userIdentifiers).toContainEqual({ phoneNumber: PHONE_E164 });
  });

  it("returns Google's requestId for the sync log", async () => {
    stubGoogle();
    expect(await googleDestination(config()).send(deal)).toBe("req-123");
  });

  it("throws with Google's status and answer when Data Manager rejects the request", async () => {
    stubGoogle(() => new Response('{"error":{"status":"INVALID_ARGUMENT"}}', { status: 400 }));
    await expect(googleDestination(config()).send(deal)).rejects.toThrow('400: {"error":{"status":"INVALID_ARGUMENT"}}');
  });

  it("throws with Google's status and answer when the token exchange is refused", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(googleDestination(config()).send(deal)).rejects.toThrow('400: {"error":"invalid_grant"}');
  });
});

describe("Google's 90-day limit", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const syncClosedDaysAgo = (days: number) =>
    syncWonDeal("11", {
      log: { claim: async () => "claimed", record: async () => {} },
      now: () => NOW,
      fetchDeal: async () => ({ ...deal, closedAt: new Date(NOW.getTime() - days * DAY_MS) }),
      destinations: [googleDestination(config())],
    });

  it("sends a sale closed 89 days ago and skips one closed 91 days ago", async () => {
    stubGoogle();
    expect(await syncClosedDaysAgo(89)).toEqual({ google: "sent" });
    expect(await syncClosedDaysAgo(91)).toEqual({ google: "skipped_too_old" });
  });
});
