import { describe, expect, it } from "vitest";
import { d1Log } from "../src/store";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const { readFileSync, readdirSync } = process.getBuiltinModule("node:fs");
const { join } = process.getBuiltinModule("node:path");
const DIR = join(process.getBuiltinModule("node:process").cwd(), "migrations");
const migration = (file: string) => readFileSync(join(DIR, file), "utf8");

// Runs the real claim and record SQL on real SQLite (Node's built-in), after the real migrations.
// D1 is SQLite, so this checks the queries the Worker sends; only the D1 client is a thin stand-in.
function d1(): { db: D1Database; sqlite: NodeDatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(DIR).sort()) sqlite.exec(migration(file));
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => sqlite.prepare(sql).get(...params) ?? null,
      run: async () => sqlite.prepare(sql).run(...params),
    }),
  });
  return { db: { prepare } as unknown as D1Database, sqlite };
}

const T0 = new Date("2026-10-25T12:00:00Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

describe("d1Log on real SQLite", () => {
  it("claims a new deal for one destination, then reports it in flight", async () => {
    const { db } = d1();
    const log = d1Log(db, at(0));
    expect(await log.claim("hubspot-deal-1", "1", "meta")).toBe("claimed");
    expect(await log.claim("hubspot-deal-1", "1", "meta")).toBe("in_flight");
  });

  it("keeps each destination separate", async () => {
    const { db } = d1();
    const log = d1Log(db, at(0));
    expect(await log.claim("hubspot-deal-1", "1", "meta")).toBe("claimed");
    expect(await log.claim("hubspot-deal-1", "1", "google")).toBe("claimed");
  });

  it("never claims a sent, too-old or rejected row again", async () => {
    const { db } = d1();
    const log = d1Log(db, at(0));
    for (const status of ["sent", "skipped_too_old", "rejected"] as const) {
      const id = `hubspot-deal-${status}`;
      await log.claim(id, status, "meta");
      await log.record(id, status, "meta", status);
      expect(await log.claim(id, status, "meta")).toBe("done");
      expect(await d1Log(db, at(5 * MIN + 1)).claim(id, status, "meta")).toBe("done"); // not taken over as a stale send
    }
  });

  it("claims a failed or skipped-for-missing-data row again and clears its detail", async () => {
    const { db, sqlite } = d1();
    const log = d1Log(db, at(0));
    for (const status of ["failed", "skipped_no_email", "skipped_no_amount"] as const) {
      const id = `hubspot-deal-${status}`;
      await log.claim(id, status, "meta");
      await log.record(id, status, "meta", status, "why");
      expect(await log.claim(id, status, "meta")).toBe("claimed");
      expect(sqlite.prepare("SELECT status, detail FROM sync_log WHERE event_id = ?").get(id)).toEqual({ status: "sending", detail: null });
    }
  });

  it("takes over an attempt stuck in sending for more than 5 minutes, not sooner", async () => {
    const { db } = d1();
    await d1Log(db, at(0)).claim("hubspot-deal-1", "1", "meta");
    expect(await d1Log(db, at(5 * MIN)).claim("hubspot-deal-1", "1", "meta")).toBe("in_flight");
    expect(await d1Log(db, at(5 * MIN + 1)).claim("hubspot-deal-1", "1", "meta")).toBe("claimed");
  });

  it("records the outcome with its detail", async () => {
    const { db, sqlite } = d1();
    const log = d1Log(db, at(0));
    await log.claim("hubspot-deal-1", "1", "google");
    await log.record("hubspot-deal-1", "1", "google", "failed", "HTTP 500");
    expect(sqlite.prepare("SELECT deal_id, status, detail FROM sync_log WHERE event_id = ? AND destination = ?").get("hubspot-deal-1", "google"))
      .toEqual({ deal_id: "1", status: "failed", detail: "HTTP 500" });
  });

  it("keeps v0 rows as Meta's after the per-destination migration", () => {
    const sqlite = new DatabaseSync(":memory:");
    const [first, ...rest] = readdirSync(DIR).sort();
    sqlite.exec(migration(first));
    sqlite.prepare("INSERT INTO sync_log (event_id, deal_id, status, updated_at) VALUES (?, ?, 'sent', ?)").run("hubspot-deal-9", "9", T0.toISOString());
    for (const file of rest) sqlite.exec(migration(file));
    expect(sqlite.prepare("SELECT destination, status FROM sync_log WHERE event_id = ?").get("hubspot-deal-9")).toEqual({ destination: "meta", status: "sent" });
  });
});
