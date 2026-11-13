import { test } from "node:test";
import assert from "node:assert/strict";
import { visiblePatterns } from "../src/results.js";

test("one result per symbol across entry and active patterns, using priority then recency", () => {
  const active = { symbol: "A", state: "RETESTING", stateTime: 500 };
  const old = { symbol: "A", state: "ENTRY_LONG", entryTime: 100 };
  const latest = { symbol: "A", state: "ENTRY_SHORT", entryTime: 200 };
  const waiting = { symbol: "B", state: "WAIT_RETEST", stateTime: 900 };
  const retesting = { symbol: "B", state: "RETESTING", stateTime: 100 };
  const other = { symbol: "C", state: "BREAKOUT", stateTime: 1000 };
  const input = [active, old, waiting, latest, retesting, other];
  const original = [...input];
  assert.deepEqual(visiblePatterns(input), [latest, retesting, other]);
  assert.deepEqual(input, original);
});

test("filters select a matching representative instead of hiding matching patterns", () => {
  const entry = { symbol: "A", state: "ENTRY_LONG", entryTime: 300, plan: { rr: 1 } };
  const highRR = { symbol: "A", state: "ENTRY_SHORT", entryTime: 100, plan: { rr: 3 } };
  const active = { symbol: "A", state: "WAIT_RETEST", stateTime: 500 };
  const input = [entry, highRR, active];
  assert.deepEqual(visiblePatterns(input, { rr: 2 }), [highRR]);
  assert.deepEqual(visiblePatterns(input, { state: "ENTRY" }), [entry]);
  assert.deepEqual(visiblePatterns(input, { state: "WAIT_RETEST" }), [active]);
  assert.deepEqual(visiblePatterns(input, { state: "RETESTING" }), []);
  assert.deepEqual(visiblePatterns([]), []);
});
