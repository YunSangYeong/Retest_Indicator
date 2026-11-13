const priority = {
  ENTRY_LONG: 0,
  ENTRY_SHORT: 0,
  RETESTING: 1,
  WAIT_RETEST: 2,
  BREAKOUT: 3,
};

// Keep the first matching pattern per symbol across both result sections.
export function visiblePatterns(results, { state = "ALL", rr = 0 } = {}) {
  const seen = new Set();
  return results
    .filter((p) =>
      (state === "ALL" ||
        (state === "ENTRY" ? p.state.startsWith("ENTRY") : p.state === state)) &&
      (!rr || (p.plan?.rr || 0) >= rr),
    )
    .sort((a, b) =>
      priority[a.state] - priority[b.state] ||
      (b.entryTime || b.stateTime) - (a.entryTime || a.stateTime),
    )
    .filter((p) => {
      if (seen.has(p.symbol)) return false;
      seen.add(p.symbol);
      return true;
    });
}
