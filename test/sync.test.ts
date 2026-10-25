import { describe, expect, it } from "vitest";
import { syncWonDeal, type Deps } from "../src/sync";
import type { SyncLog, SyncStatus } from "../src/store";

const NOW = new Date("2026-10-25T12:00:00Z"); // 1792929600 in Unix seconds

// Mirrors the D1 claim rule: a deal can be claimed when it has no row, or its row is retryable.
function memoryLog(): SyncLog & { rows: Map<string, SyncStatus> } {
  const rows = new Map<string, SyncStatus>();
  return {
    rows,
    async claim(eventId) {
      const s = rows.get(eventId);
      if (s === "sending") return "in_flight";
      if (s === "sent" || s === "skipped_too_old") return "done";
      rows.set(eventId, "sending");
      return "claimed";
    },
    async record(eventId, _dealId, status) {
      rows.set(eventId, status);
    },
  };
}

type TestDeps = Deps & { sent: unknown[]; log: ReturnType<typeof memoryLog> };

function deps(overrides: Partial<Deps> = {}): TestDeps {
  const sent: unknown[] = [];
  return {
    sent,
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
    sendToMeta: async (events) => {
      sent.push(...events);
    },
    ...overrides,
  } as TestDeps;
}

describe("syncWonDeal", () => {
  it("sends one Purchase event and logs it as sent", async () => {
    const d = deps();
    expect(await syncWonDeal("11", d)).toBe("sent");
    expect(d.sent).toHaveLength(1);
    expect(d.log.rows.get("hubspot-deal-11")).toBe("sent");
  });

  it("sends a deal only once, even when two deliveries overlap", async () => {
    const d = deps();
    const results = await Promise.all([syncWonDeal("11", d), syncWonDeal("11", d)]);
    expect(results.sort()).toEqual(["in_flight", "sent"]);
    expect(d.sent).toHaveLength(1);
  });

  it("reports a deal that already went out as a duplicate", async () => {
    const d = deps();
    await syncWonDeal("11", d);
    expect(await syncWonDeal("11", d)).toBe("duplicate");
    expect(d.sent).toHaveLength(1);
  });

  it("skips a deal with no contact email and logs why", async () => {
    const d = deps({ fetchDeal: async (dealId) => ({ dealId, closedAt: NOW, amount: 1, currency: "USD", email: null, phone: null }) });
    expect(await syncWonDeal("12", d)).toBe("skipped_no_email");
    expect(d.sent).toHaveLength(0);
  });

  it("skips a deal with no amount instead of sending a $0 sale", async () => {
    const d = deps({ fetchDeal: async (dealId) => ({ dealId, closedAt: NOW, amount: null, currency: "USD", email: "a@b.co", phone: null }) });
    expect(await syncWonDeal("16", d)).toBe("skipped_no_amount");
    expect(d.sent).toHaveLength(0);
  });

  it("logs a failure and lets a later retry send it", async () => {
    let fail = true;
    const d = deps({
      sendToMeta: async () => {
        if (fail) throw new Error("Meta 500");
      },
    });
    expect(await syncWonDeal("13", d)).toBe("failed");
    fail = false;
    expect(await syncWonDeal("13", d)).toBe("sent");
  });

  it("does not send a sale that closed more than 7 days ago, since Meta rejects it", async () => {
    const d = deps({
      fetchDeal: async (dealId) => ({ dealId, closedAt: new Date("2026-10-17T12:00:00Z"), amount: 5, currency: "USD", email: "a@b.co", phone: null }),
    });
    expect(await syncWonDeal("14", d)).toBe("skipped_too_old");
    expect(d.sent).toHaveLength(0);
  });

  it("dates a sale with a future close date at the time it is sent", async () => {
    const d = deps({
      fetchDeal: async (dealId) => ({ dealId, closedAt: new Date("2026-11-30T00:00:00Z"), amount: 5, currency: "USD", email: "a@b.co", phone: null }),
    });
    await syncWonDeal("15", d);
    expect((d.sent[0] as { event_time: number }).event_time).toBe(1792929600);
  });
});
