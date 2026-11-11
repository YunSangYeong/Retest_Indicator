import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  scanPatterns,
  levelsAt,
  atrSeries,
  tradePlan,
  closedCandles,
} from "../src/strategy.js";
const step = 900000,
  now = 1e15;
function fixture(short = false) {
  const bars = Array.from({ length: 101 }, (_, i) => ({
    time: i * step,
    open: 98,
    close: 98,
    high: 99,
    low: 97,
    volume: 100,
  }));
  for (const j of [55, 75]) bars[j].high = 100;
  bars[100] = {
    time: 100 * step,
    open: 99,
    close: 102,
    high: 102.2,
    low: 98.8,
    volume: 250,
  };
  if (short)
    for (const b of bars) {
      [b.open, b.close, b.high, b.low] = [
        200 - b.open,
        200 - b.close,
        200 - b.low,
        200 - b.high,
      ];
    }
  return bars;
}
function add(bars, open, high, low, close, volume = 100) {
  bars.push({ time: bars.length * step, open, high, low, close, volume });
  return bars;
}
function scan(b, c = {}) {
  return scanPatterns(b, c, now);
}
test("two confirmed highs/lows form valid volume breakout", () => {
  for (const short of [false, true]) {
    const r = scan(fixture(short));
    assert.equal(r.active.length, 1);
    assert.equal(r.active[0].direction, short ? "SHORT" : "LONG");
    assert.equal(r.active[0].sr, 100);
    assert.equal(r.active[0].state, "BREAKOUT");
  }
});
test("100 candle rolling window excludes older pivots and unconfirmed pivots", () => {
  const b = fixture();
  assert.equal(levelsAt(b, 100, 2, "LONG", defaults).length, 1);
  assert.equal(
    levelsAt(b, 100, 2, "LONG", { ...defaults, lookback: 30 }).length,
    0,
  );
  b[98].high = 100;
  assert.equal(levelsAt(b, 100, 2, "LONG", defaults)[0].touches, 2);
});
test("volume excludes breakout candle and rejects below 2x", () => {
  const b = fixture();
  b[100].volume = 199;
  assert.equal(scan(b).patterns.length, 0);
  b[100].volume = 200;
  assert.equal(scan(b).patterns[0].volumeMultiple, 2);
});
test("unclosed breakout excluded, exact close boundary included", () => {
  const b = fixture();
  assert.equal(scanPatterns(b, {}, 101 * step - 1).patterns.length, 0);
  assert.equal(scanPatterns(b, {}, 101 * step).patterns.length, 1);
  assert.equal(closedCandles([...b].reverse(), "15", 101 * step)[0].time, 0);
});
test("wick-only breakout rejected", () => {
  const b = fixture();
  b[100].close = 99.5;
  b[100].open = 99;
  assert.equal(scan(b).patterns.length, 0);
});
test("LONG retest with confirmation on same closed bar", () => {
  const b = add(fixture(), 100.1, 103, 99.9, 102.8);
  const p = scan(b).entries[0];
  assert.equal(p.state, "ENTRY_LONG");
  assert.equal(p.entryTime, 102 * step);
  assert.equal(p.retestIndex, 101);
  assert.equal(p.plan.target1, null);
});
test("SHORT retest", () => {
  const b = add(fixture(true), 99.9, 100.1, 97, 97.2);
  assert.equal(scan(b).entries[0].state, "ENTRY_SHORT");
});
test("failed retest invalidates before confirming", () => {
  const p = scan(add(fixture(), 101, 101.2, 98, 98.2)).patterns[0];
  assert.equal(p.state, "INVALID");
});
test("wait, retesting, expiration and state timestamps", () => {
  const b = fixture();
  for (let n = 0; n < 12; n++) add(b, 102, 103, 101, 102);
  assert.equal(scan(b).active[0].state, "WAIT_RETEST");
  add(b, 102, 103, 101, 102);
  const p = scan(b).patterns[0];
  assert.equal(p.state, "EXPIRED");
  assert.equal(p.history.at(-1).time, 114 * step);
  const c = add(fixture(), 101, 101.5, 100, 101);
  assert.equal(scan(c).active[0].state, "RETESTING");
});
test("same-zone breakout suppressed during retest window", () => {
  const b = add(fixture(), 100, 100.2, 99.9, 100);
  add(b, 99, 102.2, 98.8, 102, 250);
  assert.equal(scan(b).patterns.length, 1);
});
test("recent 10 closed bars excludes old entry without mutating it", () => {
  const b = add(fixture(), 100.1, 103, 99.9, 102.8);
  const original = scan(b).entries[0];
  for (let n = 0; n < 10; n++) add(b, 103, 104, 102, 103);
  const r = scan(b);
  assert.equal(r.entries.length, 0);
  assert.deepEqual(r.patterns[0], original);
});
test("causal prefix invariance with later data and wider lookback", () => {
  const b = fixture();
  const p = scan(b).patterns[0];
  for (let n = 0; n < 8; n++) add(b, 102, 110 + n, 101, 103);
  const after = scan(b).patterns[0];
  assert.equal(after.sr, p.sr);
  assert.equal(after.breakoutTime, p.breakoutTime);
  assert.equal(after.boxHeight, p.boxHeight);
  assert.equal(scan(b, { lookback: 150 }).patterns.length, 0);
});
test("trade plan excludes retest high, validates RR and mirrored SHORT", () => {
  const b = fixture();
  add(b, 102, 105, 101, 104);
  add(b, 100, 101, 99.8, 100.8);
  const p = {
    direction: "LONG",
    sr: 100,
    breakoutIndex: 100,
    retestIndex: 102,
    boxHeight: 10,
  };
  const plan = tradePlan(p, b, 102, 2);
  assert.equal(plan.target1, 105);
  assert.equal(plan.target2, 110);
  assert.equal(plan.stop, 99.39999999999999);
  assert.ok(Math.abs(plan.rr1 - 3) < 1e-10);
  p.boxHeight = null;
  assert.equal(tradePlan(p, b, 102, 2).target2, null);
  const inverse = b.map((c) => ({
    ...c,
    open: 200 - c.open,
    close: 200 - c.close,
    high: 200 - c.low,
    low: 200 - c.high,
  }));
  const s = tradePlan(
    { ...p, direction: "SHORT", boxHeight: 10 },
    inverse,
    102,
    2,
  );
  assert.ok(Math.abs(s.rr1 - plan.rr1) < 1e-10);
});
