import { test } from "node:test";
import assert from "node:assert/strict";
import { BybitClient, scanMarket } from "../src/api.js";
import { defaults } from "../src/strategy.js";
const response = (result) => ({
  ok: true,
  json: async () => ({ retCode: 0, result }),
});
test("pagination, exact USDT perpetual filter, turnover and deduplication", async () => {
  const instrument = (symbol) => ({
    symbol,
    status: "Trading",
    contractType: "LinearPerpetual",
    quoteCoin: "USDT",
    settleCoin: "USDT",
  });
  let pages = 0;
  const c = new BybitClient({
    fetcher: async (url) => {
      if (url.includes("tickers"))
        return response({
          list: [
            { symbol: "AUSDT", turnover24h: "10000000" },
            { symbol: "BUSDT", turnover24h: "1" },
            { symbol: "CUSDT", turnover24h: "20000000" },
          ],
        });
      pages++;
      return response({
        list:
          pages === 1
            ? [instrument("AUSDT"), instrument("BUSDT")]
            : [
                { ...instrument("CUSDT"), contractType: "LinearFutures" },
                instrument("AUSDT"),
              ],
        nextPageCursor: pages === 1 ? "next" : "",
      });
    },
  });
  assert.deepEqual(await c.symbols(1e7), ["AUSDT"]);
  assert.equal(pages, 2);
});
test("retry exponential backoff and final error", async () => {
  let calls = 0,
    delays = [];
  const c = new BybitClient({
    fetcher: async () => {
      calls++;
      throw new Error("network");
    },
    sleep: async (ms) => delays.push(ms),
  });
  await assert.rejects(c.get("/test", {}), /network/);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
});
test("HTTP errors and API errors retry; eventual success", async () => {
  let calls = 0;
  const c = new BybitClient({
    sleep: async () => {},
    fetcher: async () =>
      ++calls === 1
        ? { ok: false, status: 429 }
        : calls === 2
          ? { ok: true, json: async () => ({ retCode: 10006, retMsg: "rate" }) }
          : response({ list: [] }),
  });
  await c.get("/test", {});
  assert.equal(calls, 3);
});
test("OI failure is optional; breakout boundary samples yield percentage", async () => {
  const c = new BybitClient({
    retries: 0,
    fetcher: async () => {
      throw new Error("OI failed");
    },
  });
  assert.equal(await c.oi("A", { breakoutTime: 1800000 }, defaults), null);
  c.fetcher = async () =>
    response({
      list: [
        { timestamp: "1800000", openInterest: "110" },
        { timestamp: "900000", openInterest: "100" },
      ],
    });
  assert.ok(
    Math.abs(
      (await c.oi("A", { breakoutTime: 1800000 }, defaults)).change - 10,
    ) < 1e-10,
  );
});
test("partial failure and concurrency limit", async () => {
  let live = 0,
    max = 0;
  const updates = [];
  const c = {
    candles: async (s) => {
      live++;
      max = Math.max(live, max);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      if (s === "B") throw new Error("bad");
      return [];
    },
    oi: async () => null,
  };
  const out = await scanMarket(["A", "B", "C", "D"], c, defaults, {
    analyze: () => ({ active: [], entries: [] }),
    concurrency: 2,
    onProgress: (p) => updates.push(p),
  });
  assert.equal(out.failures.length, 1);
  assert.equal(max, 2);
  assert.deepEqual(updates.at(-1), {
    total: 4,
    completed: 4,
    success: 3,
    failed: 1,
    matches: 0,
  });
});
test("abort prevents requests and does not count as symbol failure", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    scanMarket(["A"], {}, defaults, { signal: controller.signal }),
    { name: "AbortError" },
  );
});
test("kline pagination sorts and deduplicates", async () => {
  let calls = 0;
  const c = new BybitClient({
    fetcher: async () => {
      calls++;
      return response({
        list:
          calls === 1
            ? [
                [300, 1, 2, 0, 1, 10],
                [200, 1, 2, 0, 1, 10],
              ]
            : calls === 2
              ? [[100, 1, 2, 0, 1, 10]]
              : [],
      });
    },
  });
  assert.deepEqual(
    (await c.candles("A", defaults)).map((b) => b.time),
    [100, 200, 300],
  );
});
test("request timeout aborts underlying fetch and reports failure", async () => {
  const c = new BybitClient({
    timeout: 10,
    retries: 0,
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout not propagated")),
          500,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  });
  await assert.rejects(c.get("/slow", {}), { name: "TimeoutError" });
});

test("chart snapshot reuses analyzed closed candles and scan interval", async () => {
  const bars = [
    { time: 1700000000000, open: 1, high: 2, low: 0.5, close: 1.5 },
  ];
  const client = { candles: async () => bars, oi: async () => null };
  const result = await scanMarket(
    ["TESTUSDT"],
    client,
    { ...defaults, interval: "60" },
    {
      analyze: () => ({ bars, active: [{ state: "BREAKOUT" }], entries: [] }),
    },
  );
  assert.equal(result.results[0].chart.bars, bars);
  assert.equal(result.results[0].chart.interval, "60");
});
