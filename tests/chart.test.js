import { test } from "node:test";
import assert from "node:assert/strict";
import { chartModel } from "../src/chart.js";
const bars = Array.from({ length: 4 }, (_, i) => ({
  time: 1700000000000 + i * 900000,
  open: 100,
  high: 103,
  low: 99,
  close: 102,
}));
test("chart uses exact snapshot bar open times, including retest and entry on same candle", () => {
  const model = chartModel({
    direction: "LONG",
    sr: 100,
    breakoutIndex: 1,
    retestIndex: 2,
    entryIndex: 2,
    chart: { bars, interval: "15" },
    plan: { entry: 102, stop: 98, target1: null, target2: 110 },
  });
  assert.equal(model.candles.length, 4);
  assert.deepEqual(
    model.markers.map((m) => [m.time, m.text]),
    [
      [bars[1].time / 1000, "돌파"],
      [bars[2].time / 1000, "리테스트"],
      [bars[2].time / 1000, "롱 진입"],
    ],
  );
  assert.deepEqual(
    model.levels.map((l) => l.title),
    ["SR", "진입", "손절", "목표 2"],
  );
});
test("pending SHORT displays only breakout and SR without invented retest or plan", () => {
  const model = chartModel({
    direction: "SHORT",
    sr: 100,
    breakoutIndex: 1,
    retestIndex: null,
    chart: { bars, interval: "60" },
  });
  assert.equal(model.markers.length, 1);
  assert.deepEqual(
    model.levels.map((l) => l.title),
    ["SR"],
  );
});
