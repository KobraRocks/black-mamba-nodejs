import { assert, assertEquals } from "./deps.ts";
import SQLITE, { Iterator } from "../mod.ts";

Deno.test("database record mode toggles", () => {
  const path = Deno.makeTempFileSync();
  const sqlite = SQLITE.createDatabase(path);
  assertEquals(sqlite.records.setting, Iterator.SET);
  sqlite.records.useArray();
  assertEquals(sqlite.records.setting, Iterator.ARRAY);
  sqlite.records.useSet();
  assertEquals(sqlite.records.setting, Iterator.SET);
});

Deno.test("statement record mode toggles and execution", () => {
  const path = Deno.makeTempFileSync();
  const sqlite = SQLITE.createDatabase(path);
  const stmt = sqlite.prepare_match_all("SELECT 1");
  assertEquals(stmt.records.setting, Iterator.SET);
  stmt.returnRecordsAsArray();
  assertEquals(stmt.records.setting, Iterator.ARRAY);
  const { records } = stmt.execute();
  assert(Array.isArray(records));
});

Deno.test("statement execution failure returns error", () => {
  const path = Deno.makeTempFileSync();
  const sqlite = SQLITE.createDatabase(path);
  const stmt = sqlite.prepare_match_first("SELECT * FROM missing");
  const { record, error } = stmt.execute();
  assert(record === undefined);
  assert(error instanceof Error);
});
