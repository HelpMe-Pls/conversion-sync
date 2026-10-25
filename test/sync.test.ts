import { afterEach, describe, expect, it, vi } from "vitest";
import { syncWonDeal, type Deps } from "../src/sync";
import { metaDestination } from "../src/meta";
import type { SyncLog, SyncStatus } from "../src/store";

const NOW = new Date("2026-10-25T12:00:00Z"); // 1792929600 in Unix seconds

// Mirrors the D1 claim rule: a (deal, destination) can be claimed when it has no row, or its row is retryable.
function memoryLog(): SyncLog & { rows: Map<string, SyncStatus> } {
  const rows = new Map<string, SyncStatus>();
  return {
    rows,
    async claim(eventId, _dealId, destination) {
      const key = `${eventId}/${destination}`;
      const s = rows.get(key);
      if (s === "sending") return "in_flight";
      if (s === "sent" || s === "skipped_too_old") return "done";
      rows.set(key, "sending");
      return "claimed";
    },
    async record(eventId, _dealId, destination, status) {
      rows.set(`${eventId}/${destination}`, status);
    },
  };
}

// Meta is the real destination; only its HTTP call is stubbed. `sent` collects the events Meta received.
function stubMeta(status: () => number = () => 200): unknown[] {
  const sent: unknown[] = [];
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const code = status();
    if (code === 200) sent.push(...(JSON.parse(String(init?.body)) as { data: unknown[] }).data);
    return new Response("{}", { status: code });
  });
  return sent;
}

type TestDeps = Deps & { log: ReturnType<typeof memoryLog> };

function deps(overrides: Partial<Deps> = {}): TestDeps {
  return {
    log: memoryLog(),
    now: () => NOW,
    fetchDeal: async (dealId) => ({
      dealId,
      closedAt: new Date("2026-10-25T11:00:00Z"),
      amount: 900,
      currency: "USD",
      email: "buyer@example.com",
      phone: null,
    }),
    destinations: [metaDestination({ pixelId: "px", accessToken: "t", apiVersion: "v21.0" })],
    ...overrides,
  } as TestDeps;
}

afterEach(() => vi.unstubAllGlobals());

describe("syncWonDeal with Meta as the only destination", () => {
  it("sends one Purchase event and logs it as sent", async () => {
    const sent = stubMeta();
    const d = deps();
    expect(await syncWonDeal("11", d)).toEqual({ meta: "sent" });
    expect(sent).toHaveLength(1);
    expect(d.log.rows.get("hubspot-deal-11/meta")).toBe("sent");
  });

  it("sends a deal only once, even when two deliveries overlap", async () => {
    const sent = stubMeta();
    const d = deps();
    const results = await Promise.all([syncWonDeal("11", d), syncWonDeal("11", d)]);
    expect(results.map((r) => r.meta).sort()).toEqual(["in_flight", "sent"]);
    expect(sent).toHaveLength(1);
  });

  it("reports a deal that already went out as a duplicate", async () => {
    const sent = stubMeta();
    const d = deps();
    await syncWonDeal("11", d);
    expect(await syncWonDeal("11", d)).toEqual({ meta: "duplicate" });
    expect(sent).toHaveLength(1);
  });

  it("skips a deal with no contact email and logs why", async () => {
    const sent = stubMeta();
    const d = deps({ fetchDeal: async (dealId) => ({ dealId, closedAt: NOW, amount: 1, currency: "USD", email: null, phone: null }) });
    expect(await syncWonDeal("12", d)).toEqual({ meta: "skipped_no_email" });
    expect(sent).toHaveLength(0);
  });

  it("skips a deal with no amount instead of sending a $0 sale", async () => {
    const sent = stubMeta();
    const d = deps({ fetchDeal: async (dealId) => ({ dealId, closedAt: NOW, amount: null, currency: "USD", email: "a@b.co", phone: null }) });
    expect(await syncWonDeal("16", d)).toEqual({ meta: "skipped_no_amount" });
    expect(sent).toHaveLength(0);
  });

  it("logs a failure and lets a later retry send it", async () => {
    let fail = true;
    stubMeta(() => (fail ? 500 : 200));
    const d = deps();
    expect(await syncWonDeal("13", d)).toEqual({ meta: "failed" });
    fail = false;
    expect(await syncWonDeal("13", d)).toEqual({ meta: "sent" });
  });

  it("does not send a sale that closed more than 7 days ago, since Meta rejects it", async () => {
    const sent = stubMeta();
    const d = deps({
      fetchDeal: async (dealId) => ({ dealId, closedAt: new Date("2026-10-17T12:00:00Z"), amount: 5, currency: "USD", email: "a@b.co", phone: null }),
    });
    expect(await syncWonDeal("14", d)).toEqual({ meta: "skipped_too_old" });
    expect(sent).toHaveLength(0);
  });

  it("dates a sale with a future close date at the time it is sent", async () => {
    const sent = stubMeta();
    const d = deps({
      fetchDeal: async (dealId) => ({ dealId, closedAt: new Date("2026-11-30T00:00:00Z"), amount: 5, currency: "USD", email: "a@b.co", phone: null }),
    });
    await syncWonDeal("15", d);
    expect((sent[0] as { event_time: number }).event_time).toBe(1792929600);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

// A destination that records what it received, and fails while `failing` is true.
function fakeDestination(name: string, maxAgeMs = 7 * DAY_MS) {
  const received: string[] = [];
  const dest = {
    name,
    maxAgeMs,
    failing: false,
    received,
    async send(deal: { dealId: string }) {
      if (dest.failing) throw new Error(`${name} 500`);
      received.push(deal.dealId);
    },
  };
  return dest;
}

describe("syncWonDeal with two destinations", () => {
  it("retries a deal only for the destination that failed", async () => {
    const meta = fakeDestination("meta");
    const google = fakeDestination("google");
    const d = deps({ destinations: [meta, google] });

    google.failing = true;
    expect(await syncWonDeal("21", d)).toEqual({ meta: "sent", google: "failed" });

    google.failing = false;
    expect(await syncWonDeal("21", d)).toEqual({ meta: "duplicate", google: "sent" });
    expect(meta.received).toEqual(["21"]);
    expect(google.received).toEqual(["21"]);
  });

  it("applies each destination's own age limit to the same sale", async () => {
    const meta = fakeDestination("meta", 7 * DAY_MS);
    const google = fakeDestination("google", 90 * DAY_MS);
    const d = deps({
      destinations: [meta, google],
      fetchDeal: async (dealId) => ({ dealId, closedAt: new Date("2026-09-25T12:00:00Z"), amount: 5, currency: "USD", email: "a@b.co", phone: null }),
    });
    expect(await syncWonDeal("22", d)).toEqual({ meta: "skipped_too_old", google: "sent" });
  });
});
