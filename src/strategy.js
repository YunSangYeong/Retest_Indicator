export const defaults = {
  lookback: 100,
  pivot: 3,
  touches: 2,
  spacing: 3,
  volumePeriod: 20,
  volumeMultiple: 2,
  retestBars: 12,
  recentBars: 10,
  turnover: 10000000,
  direction: "ALL",
  interval: "15",
};
export const closedCandles = (bars, interval, now = Date.now()) =>
  [...bars]
    .filter((b) => b.time + Number(interval) * 60000 <= now)
    .sort((a, b) => a.time - b.time);
const median = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};
// Wilder ATR; every value depends only on this and earlier candles.
export function atrSeries(bars, period = 14) {
  let value;
  return bars.map((b, i) => {
    const tr = Math.max(
      b.high - b.low,
      i ? Math.abs(b.high - bars[i - 1].close) : 0,
      i ? Math.abs(b.low - bars[i - 1].close) : 0,
    );
    if (i < period) {
      value = (value || 0) + tr;
      if (i === period - 1) {
        value /= period;
        return value;
      }
      return null;
    }
    value = (value * (period - 1) + tr) / period;
    return value;
  });
}
// At breakout index i, even the rightmost pivot confirmation must precede i.
export function levelsAt(bars, i, atr, side, cfg) {
  const points = [],
    key = side === "LONG" ? "high" : "low",
    p = cfg.pivot;
  for (let j = Math.max(p, i - cfg.lookback); j + p < i; j++) {
    const price = bars[j][key];
    let valid = true;
    for (let k = j - p; k <= j + p; k++)
      if (
        k !== j &&
        (side === "LONG" ? bars[k].high >= price : bars[k].low <= price)
      ) {
        valid = false;
        break;
      }
    if (valid) points.push({ price, index: j });
  }
  const groups = [];
  for (const point of points) {
    let group = groups.find(
      (g) =>
        Math.max(...g.map((x) => x.price), point.price) -
          Math.min(...g.map((x) => x.price), point.price) <=
          atr * 0.3 && point.index - g.at(-1).index >= cfg.spacing,
    );
    if (group) group.push(point);
    else groups.push([point]);
  }
  return groups
    .filter((g) => g.length >= cfg.touches)
    .map((g) => ({ price: median(g.map((x) => x.price)), touches: g.length }));
}
export function tradePlan(pattern, bars, index, atr) {
  const long = pattern.direction === "LONG",
    sign = long ? 1 : -1,
    entry = bars[index].close,
    sr = pattern.sr;
  const segment = bars.slice(pattern.retestIndex, index + 1);
  const extreme = long
    ? Math.min(...segment.map((b) => b.low))
    : Math.max(...segment.map((b) => b.high));
  const stop = long
    ? Math.min(extreme, sr - 0.2 * atr) - 0.1 * atr
    : Math.max(extreme, sr + 0.2 * atr) + 0.1 * atr;
  // The only target projects the box height confirmed before breakout.
  const rawTarget = pattern.boxHeight ? sr + sign * pattern.boxHeight : null;
  const risk = sign * (entry - stop);
  const target =
    rawTarget !== null &&
    Number.isFinite(rawTarget) &&
    sign * (rawTarget - entry) > 0 &&
    risk > 0
      ? rawTarget
      : null;
  return {
    entry,
    stop: risk > 0 ? stop : null,
    target,
    rr: target === null ? null : (sign * (target - entry)) / risk,
  };
}
export function scanPatterns(input, options = {}, now = Date.now()) {
  const cfg = { ...defaults, ...options },
    bars = closedCandles(input, cfg.interval, now),
    atrs = atrSeries(bars),
    patterns = [];
  const transition = (p, state, i) => {
    p.state = state;
    p.stateTime = bars[i].time + Number(cfg.interval) * 60000;
    p.history.push({ state, time: p.stateTime });
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i],
      atr = atrs[i];
    if (!atr) continue;
    for (const p of patterns.filter(
      (p) =>
        !["INVALID", "EXPIRED", "ENTRY_LONG", "ENTRY_SHORT"].includes(p.state),
    )) {
      if (i === p.breakoutIndex) continue;
      const long = p.direction === "LONG";
      if (long ? b.close < p.sr - 0.2 * atr : b.close > p.sr + 0.2 * atr) {
        transition(p, "INVALID", i);
        continue;
      }
      if (i - p.breakoutIndex > cfg.retestBars) {
        transition(p, "EXPIRED", i);
        continue;
      }
      if (
        b.low <= p.sr + 0.2 * atr &&
        b.high >= p.sr - 0.2 * atr &&
        p.retestIndex === null
      ) {
        p.retestIndex = i;
        p.retestTime = b.time + Number(cfg.interval) * 60000;
        transition(p, "RETESTING", i);
      }
      if (
        p.retestIndex !== null &&
        (long
          ? b.close > b.open && b.close > p.sr && b.close > bars[i - 1].high
          : b.close < b.open && b.close < p.sr && b.close < bars[i - 1].low)
      ) {
        p.entryIndex = i;
        p.entryTime = b.time + Number(cfg.interval) * 60000;
        p.plan = tradePlan(p, bars, i, atr);
        transition(p, long ? "ENTRY_LONG" : "ENTRY_SHORT", i);
      } else if (p.retestIndex === null && p.state !== "WAIT_RETEST")
        transition(p, "WAIT_RETEST", i);
    }
    if (i < Math.max(cfg.lookback, cfg.volumePeriod, 14)) continue;
    const avg =
      bars.slice(i - cfg.volumePeriod, i).reduce((s, b) => s + b.volume, 0) /
      cfg.volumePeriod;
    if (avg <= 0 || b.volume / avg < cfg.volumeMultiple || b.high <= b.low)
      continue;
    for (const direction of ["LONG", "SHORT"]) {
      if (cfg.direction !== "ALL" && cfg.direction !== direction) continue;
      const long = direction === "LONG";
      if (
        !(long
          ? b.close > b.open &&
            b.close - b.open >= atr * 0.5 &&
            (b.high - b.close) / (b.high - b.low) <= 0.3
          : b.close < b.open &&
            b.open - b.close >= atr * 0.5 &&
            (b.close - b.low) / (b.high - b.low) <= 0.3)
      )
        continue;
      for (const level of levelsAt(bars, i, atr, direction, cfg)) {
        const sr = level.price;
        if (
          !(long
            ? bars[i - 1].close <= sr && b.close >= sr + 0.1 * atr
            : bars[i - 1].close >= sr && b.close <= sr - 0.1 * atr)
        )
          continue;
        // Lock the same zone during an active pattern and until its retest window ends.
        if (
          patterns.some(
            (p) =>
              p.direction === direction &&
              Math.abs(p.sr - sr) <= Math.max(p.breakoutAtr, atr) * 0.3 &&
              (i - p.breakoutIndex <= cfg.retestBars ||
                ["BREAKOUT", "WAIT_RETEST", "RETESTING"].includes(p.state)),
          )
        )
          continue;
        const opposite = levelsAt(bars, i, atr, long ? "SHORT" : "LONG", cfg)
          .map((l) => l.price)
          .filter((v) => (long ? v < sr : v > sr));
        const boxEdge = opposite.length
          ? long
            ? Math.max(...opposite)
            : Math.min(...opposite)
          : null;
        const p = {
          direction,
          sr,
          breakoutIndex: i,
          breakoutTime: b.time + Number(cfg.interval) * 60000,
          breakoutAtr: atr,
          volumeMultiple: b.volume / avg,
          boxHeight: boxEdge === null ? null : Math.abs(sr - boxEdge),
          retestIndex: null,
          retestTime: null,
          entryTime: null,
          plan: null,
          history: [],
        };
        transition(p, "BREAKOUT", i);
        patterns.push(p);
      }
    }
  }
  const cutoff = bars.length - cfg.recentBars;
  return {
    patterns,
    active: patterns.filter((p) =>
      ["BREAKOUT", "WAIT_RETEST", "RETESTING"].includes(p.state),
    ),
    entries: patterns.filter((p) => p.entryIndex >= cutoff),
    bars,
  };
}
