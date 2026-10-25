import { describe, expect, it } from "vitest";
import { buildPurchaseEvent, normalizeEmail, normalizePhone, sha256Hex } from "../src/meta";

// Literal SHA-256 digests, computed independently with `shasum -a 256`.
const JANE = "8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d"; // jane@example.com
const PHONE_US = "91a02cd9e0fdea8309e2361e0c1d2eb133b283c1cc08d5562185d25a613783af"; // 15550109999
const AB = "80305c9bb1bb2480e03894350e0a8a366dcbdeb302e69e0817aa0743abd77054"; // a@b.co

describe("normalization (Meta CAPI hashing rules)", () => {
  it("trims and lowercases email", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("keeps the digits of an international number", () => {
    expect(normalizePhone("+1 (555) 010-9999")).toBe("15550109999");
  });

  it("drops a 00 international prefix and an extension", () => {
    expect(normalizePhone("0044 20 7946 0958")).toBe("442079460958");
    expect(normalizePhone("+1 555 010 9999 ext 12")).toBe("15550109999");
  });

  it("adds the default country code to a national number, dropping its trunk zero", () => {
    expect(normalizePhone("(555) 010-9999", "1")).toBe("15550109999");
    expect(normalizePhone("020 7946 0958", "44")).toBe("442079460958");
  });

  it("leaves a national number without a country code when none is configured", () => {
    expect(normalizePhone("0555 010 9999")).toBe("5550109999");
  });

  it("hashes with SHA-256 hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("buildPurchaseEvent", () => {
  it("maps a won deal to a Purchase event with hashed identifiers", async () => {
    const event = await buildPurchaseEvent({
      dealId: "11",
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 1250,
      currency: "USD",
      email: " Jane@Example.com",
      phone: "+1 555 010 9999",
      gclid: null,
    });

    expect(event).toEqual({
      event_name: "Purchase",
      event_time: 1792929600,
      event_id: "hubspot-deal-11",
      action_source: "system_generated",
      user_data: { em: [JANE], ph: [PHONE_US] },
      custom_data: { value: 1250, currency: "USD" },
    });
  });

  it("omits identifiers that are missing instead of hashing empty strings", async () => {
    const event = await buildPurchaseEvent({
      dealId: "12",
      closedAt: new Date("2026-10-25T12:00:00Z"),
      amount: 10,
      currency: "USD",
      email: "a@b.co",
      phone: null,
      gclid: null,
    });
    expect(event.user_data).toEqual({ em: [AB] });
  });
});
