// The slice of Node the D1 tests use; the project has no Node types (it targets Workers).
// Loaded through process.getBuiltinModule because Vite 5 does not know the node:sqlite builtin.
interface NodeStatementSync {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
}
interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementSync;
}
interface NodeBuiltins {
  "node:sqlite": { DatabaseSync: new (path: string) => NodeDatabaseSync };
  "node:fs": { readFileSync(path: string, encoding: "utf8"): string; readdirSync(path: string): string[] };
  "node:path": { join(...parts: string[]): string };
  "node:process": { cwd(): string };
}
declare const process: { getBuiltinModule<K extends keyof NodeBuiltins>(id: K): NodeBuiltins[K] };
