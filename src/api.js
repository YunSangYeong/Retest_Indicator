export class BybitClient {
  constructor({
    base = "https://api.bybit.com",
    fetcher = (...args) => globalThis.fetch(...args),
    retries = 3,
    timeout = 12000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    Object.assign(this, { base, fetcher, retries, timeout, sleep });
  }
  async get(path, params, signal) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await this.fetcher(
          `${this.base}${path}?${new URLSearchParams(params)}`,
          {
            signal: AbortSignal.any([
              AbortSignal.timeout(this.timeout),
              ...(signal ? [signal] : []),
            ]),
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.retCode !== 0)
          throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
        return data;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt >= this.retries) throw error;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }
  async symbols(turnover, signal) {
    let cursor = "",
      instruments = [];
    const seen = new Set();
    do {
      const data = await this.get(
        "/v5/market/instruments-info",
        { category: "linear", limit: "1000", ...(cursor ? { cursor } : {}) },
        signal,
      );
      instruments.push(...data.result.list);
      cursor = data.result.nextPageCursor || "";
      if (cursor && seen.has(cursor)) throw new Error("페이지 커서 반복");
      seen.add(cursor);
    } while (cursor);
    const ticks = await this.get(
        "/v5/market/tickers",
        { category: "linear" },
        signal,
      ),
      volumes = new Map(
        ticks.result.list.map((t) => [t.symbol, Number(t.turnover24h)]),
      );
    return [
      ...new Set(
        instruments
          .filter(
            (i) =>
              i.status === "Trading" &&
              i.contractType === "LinearPerpetual" &&
              i.quoteCoin === "USDT" &&
              i.settleCoin === "USDT" &&
              (volumes.get(i.symbol) || 0) >= turnover,
          )
          .map((i) => i.symbol),
      ),
    ].sort();
  }
  async candles(symbol, cfg, signal) {
    const required =
      cfg.lookback +
      cfg.pivot * 2 +
      cfg.retestBars +
      cfg.recentBars +
      cfg.volumePeriod +
      30;
    const map = new Map();
    let end;
    while (map.size < required) {
      const data = await this.get(
        "/v5/market/kline",
        {
          category: "linear",
          symbol,
          interval: cfg.interval,
          limit: String(Math.min(1000, required - map.size)),
          ...(end ? { end: String(end) } : {}),
        },
        signal,
      );
      if (!data.result.list.length) break;
      let oldest = Infinity;
      for (const r of data.result.list) {
        const time = Number(r[0]);
        oldest = Math.min(oldest, time);
        map.set(time, {
          time,
          open: +r[1],
          high: +r[2],
          low: +r[3],
          close: +r[4],
          volume: +r[5],
        });
      }
      if (end && oldest >= end) break;
      end = oldest - 1;
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }
  async oi(symbol, pattern, cfg, signal) {
    try {
      const step = Number(cfg.interval) * 60000,
        t = pattern.breakoutTime;
      const data = await this.get(
        "/v5/market/open-interest",
        {
          category: "linear",
          symbol,
          intervalTime: cfg.interval === "60" ? "1h" : "15min",
          startTime: String(t - step * 2),
          endTime: String(t),
          limit: "10",
        },
        signal,
      );
      const points = data.result.list
        .map((p) => ({ time: +p.timestamp, value: +p.openInterest }))
        .sort((a, b) => a.time - b.time);
      const before = points.filter((p) => p.time <= t - step).at(-1),
        after = points.filter((p) => p.time > t - step && p.time <= t).at(-1);
      if (!before || !after || before.value <= 0) return null;
      return {
        before: before.value,
        after: after.value,
        change: (after.value / before.value - 1) * 100,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  }
}
export async function scanMarket(
  symbols,
  client,
  cfg,
  {
    signal,
    onProgress = () => {},
    analyze,
    concurrency = 3,
    now = Date.now(),
  } = {},
) {
  let cursor = 0;
  const results = [],
    failures = [];
  let success = 0;
  async function worker() {
    while (cursor < symbols.length) {
      signal?.throwIfAborted();
      const symbol = symbols[cursor++];
      try {
        const bars = await client.candles(symbol, cfg, signal),
          scan = analyze(bars, cfg, now);
        const patterns = [...scan.entries, ...scan.active];
        for (const p of patterns) {
          p.symbol = symbol;
          p.chart = { bars: scan.bars, interval: cfg.interval };
          p.oi = await client.oi(symbol, p, cfg, signal);
        }
        results.push(...patterns);
        success++;
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ symbol, message: error.message });
      }
      onProgress({
        total: symbols.length,
        completed: success + failures.length,
        success,
        failed: failures.length,
        matches: new Set(results.map((p) => p.symbol)).size,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, worker),
  );
  return { results, failures };
}
