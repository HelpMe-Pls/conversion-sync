import { describe, expect, it } from "vitest";
import { buildPurchaseEvent, normalizeEmail, normalizePhone, sha256Hex } from "../src/meta";

describe("normalization (Meta CAPI hashing rules)", () => {
  it("trims and lowercases email", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("keeps digits only for phone", () => {
    expect(normalizePhone("+1 (555) 010-9999")).toBe("15550109999");
  });

  it("hashes with SHA-256 hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("buildPurchaseEvent", () => {
  it("maps a won deal to a deduplicated Purchase event with hashed identifiers", async () => {
    const event = await buildPurchaseEvent({
      dealId: "11",
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 1250,
      currency: "USD",
      email: " Jane@Example.com",
      phone: "+1 555 010 9999",
    });

    expect(event).toEqual({
      event_name: "Purchase",
      event_time: 1792929600,
      event_id: "hubspot-deal-11",
      action_source: "system_generated",
      user_data: {
        em: [await sha256Hex("jane@example.com")],
        ph: [await sha256Hex("15550109999")],
      },
      custom_data: { value: 1250, currency: "USD" },
    });
  });

  it("omits identifiers that are missing instead of hashing empty strings", async () => {
    const event = await buildPurchaseEvent({
      dealId: "12",
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 0,
      currency: "USD",
      email: "a@b.co",
      phone: null,
    });
    expect(event.user_data).toEqual({ em: [await sha256Hex("a@b.co")] });
  });
});
