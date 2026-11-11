import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";

const kst = (seconds) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(seconds * 1000));

// Signal times are candle CLOSE times; the chart library places candles at OPEN times.
// Derive markers from the exact scan snapshot rather than refetching or reanalyzing.
export function chartModel(pattern) {
  const bars = pattern.chart?.bars || [];
  const events = [
    {
      index: pattern.breakoutIndex,
      label: "돌파",
      color: "#f5c76b",
      position: "aboveBar",
      shape: "arrowDown",
    },
    {
      index: pattern.retestIndex,
      label: "리테스트",
      color: "#87baff",
      position: "belowBar",
      shape: "circle",
    },
    {
      index: pattern.entryIndex,
      label: pattern.direction === "LONG" ? "롱 진입" : "숏 진입",
      color: pattern.direction === "LONG" ? "#62e6bd" : "#ff9dba",
      position: pattern.direction === "LONG" ? "belowBar" : "aboveBar",
      shape: pattern.direction === "LONG" ? "arrowUp" : "arrowDown",
    },
  ].filter((e) => Number.isInteger(e.index) && bars[e.index]);
  const markers = events
    .map((e) => ({
      time: bars[e.index].time / 1000,
      position: e.position,
      color: e.color,
      shape: e.shape,
      text: e.label,
    }))
    .sort((a, b) => a.time - b.time);
  const plan = pattern.plan || {};
  const levels = [
    { title: "SR", price: pattern.sr, color: "#f5c76b" },
    { title: "진입", price: plan.entry, color: "#62e6bd" },
    { title: "손절", price: plan.stop, color: "#ff8797" },
    { title: "목표 1", price: plan.target1, color: "#87baff" },
    { title: "목표 2", price: plan.target2, color: "#bca1ff" },
  ].filter((l) => Number.isFinite(l.price));
  return {
    candles: bars.map((b) => ({
      time: b.time / 1000,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })),
    markers,
    levels,
  };
}

export function inlineChart(pattern) {
  const section = document.createElement("section");
  section.className = "inline-chart";
  const title = document.createElement("h4");
  title.textContent = `패턴 차트 · ${pattern.chart?.interval === "60" ? "1시간" : "15분"} · KST`;
  const legend = document.createElement("p");
  legend.className = "chart-legend";
  legend.textContent = "◆ 돌파 · ● 리테스트 · ↑/↓ 진입 확인";
  const host = document.createElement("div");
  host.className = "chart-canvas";
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", `${pattern.symbol} 돌파·리테스트 캔들 차트`);
  const summary = document.createElement("p");
  summary.className = "chart-summary";
  summary.textContent =
    "봉 시작 시각 기준 · 검색 당시 확정봉 스냅샷 · 드래그 이동 / 확대·축소";
  const credit = document.createElement("a");
  credit.href = "https://www.tradingview.com/";
  credit.target = "_blank";
  credit.rel = "noopener noreferrer";
  credit.className = "chart-credit";
  credit.textContent =
    "TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.";
  section.append(title, legend, host, summary, credit);
  let chart,
    observer,
    disposed = false;
  const model = chartModel(pattern);
  if (!model.candles.length) {
    host.textContent = "차트 데이터가 없습니다";
    return { element: section, dispose: () => {} };
  }
  const draw = () => {
    if (disposed || chart) return;
    observer?.disconnect();
    try {
      chart = createChart(host, {
        autoSize: true,
        height: 300,
        layout: {
          background: { type: ColorType.Solid, color: "#0c1421" },
          textColor: "#9eafc6",
          fontSize: 10,
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: "#1b293c" },
          horzLines: { color: "#1b293c" },
        },
        rightPriceScale: {
          borderColor: "#304058",
          scaleMargins: { top: 0.2, bottom: 0.2 },
        },
        timeScale: {
          borderColor: "#304058",
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (t) => kst(t),
        },
        localization: { timeFormatter: (t) => kst(t) },
        handleScroll: { vertTouchDrag: false, horzTouchDrag: true },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#62e6bd",
        downColor: "#ff8797",
        wickUpColor: "#62e6bd",
        wickDownColor: "#ff8797",
        borderVisible: false,
      });
      const minPrice = Math.min(...model.candles.map((b) => b.low));
      const precision = Math.min(
        10,
        Math.max(2, Math.ceil(-Math.log10(minPrice)) + 3),
      );
      series.applyOptions({
        priceFormat: { type: "price", precision, minMove: 10 ** -precision },
      });
      series.setData(model.candles);
      createSeriesMarkers(series, model.markers);
      for (const level of model.levels)
        series.createPriceLine({
          ...level,
          lineWidth: 1,
          lineStyle: level.title === "SR" ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
        });
      // Keep enough pre-breakout context while allowing the full snapshot to be explored.
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, pattern.breakoutIndex - 30),
        to: model.candles.length + 4,
      });
      host.dataset.ready = "true";
    } catch (error) {
      chart?.remove();
      chart = null;
      host.replaceChildren();
      host.textContent = "차트 표시 실패: " + error.message;
    }
  };
  // Results are automatic; only offscreen charts wait to allocate canvases.
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) draw();
    },
    { rootMargin: "200px" },
  );
  observer.observe(host);
  return {
    element: section,
    dispose: () => {
      disposed = true;
      observer.disconnect();
      chart?.remove();
    },
  };
}
