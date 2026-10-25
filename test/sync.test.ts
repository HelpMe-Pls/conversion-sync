import { describe, expect, it } from "vitest";
import { syncWonDeal, type Deps } from "../src/sync";
import type { SyncLog } from "../src/store";

function memoryLog(): SyncLog & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async has(eventId) {
      return rows.get(eventId) === "sent";
    },
    async record(eventId, _dealId, status) {
      rows.set(eventId, status);
    },
  };
}

function deps(overrides: Partial<Deps> = {}): Deps & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    log: memoryLog(),
    fetchDeal: async (dealId) => ({
      dealId,
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 900,
      currency: "USD",
      email: "buyer@example.com",
      phone: null,
    }),
    sendToMeta: async (events) => {
      sent.push(...events);
    },
    ...overrides,
  };
}

describe("syncWonDeal", () => {
  it("sends one Purchase event and logs it as sent", async () => {
    const d = deps();
    expect(await syncWonDeal("11", d)).toBe("sent");
    expect(d.sent).toHaveLength(1);
    expect((d.log as ReturnType<typeof memoryLog>).rows.get("hubspot-deal-11")).toBe("sent");
  });

  it("is idempotent: a HubSpot retry for the same deal sends nothing", async () => {
    const d = deps();
    await syncWonDeal("11", d);
    expect(await syncWonDeal("11", d)).toBe("duplicate");
    expect(d.sent).toHaveLength(1);
  });

  it("skips a deal with no contact email and logs why", async () => {
    const d = deps({ fetchDeal: async (dealId) => ({ dealId, closedAt: new Date(), amount: 1, currency: "USD", email: null, phone: null }) });
    expect(await syncWonDeal("12", d)).toBe("skipped_no_email");
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
});
