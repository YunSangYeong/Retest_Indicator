import { defaults, scanPatterns } from "./strategy.js";
import { BybitClient, scanMarket } from "./api.js";
const $ = (id) => document.getElementById(id);
let controller,
  results = [];
const time = (t) =>
  t
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(t) + " KST"
    : "—";
const num = (n) =>
  n === null || n === undefined
    ? "계산 불가"
    : Number(n).toLocaleString("en-US", { maximumSignificantDigits: 7 });
const priority = {
  ENTRY_LONG: 0,
  ENTRY_SHORT: 0,
  RETESTING: 1,
  WAIT_RETEST: 2,
  BREAKOUT: 3,
};
function card(p) {
  const el = document.createElement("article");
  el.className = "card";
  const plan = p.plan || {};
  const title = document.createElement("div");
  title.className = "card-title";
  const name = document.createElement("h3");
  name.textContent = p.symbol;
  title.append(name);
  const badge = document.createElement("span");
  badge.className = p.direction.toLowerCase();
  badge.textContent = p.direction;
  title.append(badge);
  el.append(title);
  const state = document.createElement("p");
  state.className = "state";
  state.textContent = p.state;
  el.append(state);
  const values = [
    ["SR 가격", num(p.sr)],
    ["거래량", p.volumeMultiple.toFixed(2) + "×"],
    ["진입가", plan.entry ? num(plan.entry) : "대기"],
    ["손절가", plan.entry ? num(plan.stop) : "—"],
    ["1차 목표", plan.entry ? num(plan.target1) : "—"],
    ["1차 손익비", plan.rr1 ? `1:${plan.rr1.toFixed(2)}` : "—"],
    ["2차 목표", plan.entry ? num(plan.target2) : "—"],
    ["2차 손익비", plan.rr2 ? `1:${plan.rr2.toFixed(2)}` : "—"],
    ["돌파", time(p.breakoutTime)],
    ["리테스트", time(p.retestTime)],
    ["진입 확정", time(p.entryTime)],
    [
      "OI 변화",
      p.oi
        ? `${p.oi.change >= 0 ? "+" : ""}${p.oi.change.toFixed(2)}%`
        : "미조회 / 제공 불가",
    ],
  ];
  if (p.oi)
    values.push(
      ["돌파 전 OI", num(p.oi.before)],
      ["돌파 후 OI", num(p.oi.after)],
    );
  const dl = document.createElement("dl");
  for (const [k, v] of values) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
  el.append(dl);
  const details = document.createElement("details"),
    summary = document.createElement("summary");
  summary.textContent = "상태 이력";
  details.append(summary);
  for (const h of p.history) {
    const row = document.createElement("p");
    row.textContent = `${h.state} · ${time(h.time)}`;
    details.append(row);
  }
  el.append(details);
  const a = document.createElement("a");
  a.textContent = "TradingView 차트 ↗";
  a.href = `https://www.tradingview.com/chart/?symbol=BYBIT%3A${encodeURIComponent(p.symbol)}.P`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  el.append(a);
  return el;
}
function render() {
  const state = $("state").value,
    rr = +$("rr").value;
  const visible = results
    .filter(
      (p) =>
        (state === "ALL" ||
          (state === "ENTRY"
            ? p.state.startsWith("ENTRY")
            : p.state === state)) &&
        (!rr || Math.max(p.plan?.rr1 || 0, p.plan?.rr2 || 0) >= rr),
    )
    .sort(
      (a, b) =>
        priority[a.state] - priority[b.state] ||
        (b.entryTime || b.stateTime) - (a.entryTime || a.stateTime),
    );
  $("count").textContent = visible.length;
  for (const [id, entry] of [
    ["entries", true],
    ["active", false],
  ]) {
    const container = $(id);
    container.replaceChildren();
    const rows = visible.filter((p) => p.state.startsWith("ENTRY") === entry);
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "현재 조건을 충족하는 종목이 없습니다";
      container.append(empty);
    } else rows.forEach((p) => container.append(card(p)));
  }
}
$("state").onchange = render;
$("rr").onchange = render;
$("cancel").onclick = () => controller?.abort();
$("settings").onsubmit = async (event) => {
  event.preventDefault();
  controller?.abort();
  const own = new AbortController();
  controller = own;
  const cfg = { ...defaults };
  for (const [k, v] of new FormData(event.target))
    cfg[k] = ["interval", "direction"].includes(k) ? v : Number(v);
  results = [];
  render();
  $("scan").disabled = true;
  $("cancel").disabled = false;
  $("error").textContent = "";
  $("failures").hidden = true;
  $("progress").value = 0;
  $("stats").textContent = "전체 0 · 완료 0 · 성공 0 · 실패 0 · 조건 충족 0";
  $("status").textContent = "대상 종목 조회 중…";
  const client = new BybitClient({
    base: import.meta.env.VITE_BYBIT_API_BASE || "https://api.bybit.com",
  });
  if (!$("use-oi").checked) client.oi = async () => null;
  try {
    const symbols = await client.symbols(cfg.turnover, own.signal);
    const now = Date.now();
    const output = await scanMarket(symbols, client, cfg, {
      signal: own.signal,
      analyze: scanPatterns,
      now,
      onProgress: (p) => {
        $("status").textContent = "확정봉 분석 중…";
        $("progress").max = p.total || 1;
        $("progress").value = p.completed;
        $("stats").textContent =
          `전체 ${p.total} · 완료 ${p.completed} · 성공 ${p.success} · 실패 ${p.failed} · 조건 충족 ${p.matches}`;
      },
    });
    results = output.results;
    render();
    $("status").textContent = output.failures.length
      ? "검색 완료 · 일부 종목 실패"
      : "검색 완료";
    $("last").textContent = "마지막 검색 " + time(Date.now());
    $("progress").value = $("progress").max;
    if (output.failures.length) {
      $("failures").hidden = false;
      $("failures").querySelector("pre").textContent = output.failures
        .map((f) => `${f.symbol}: ${f.message}`)
        .join("\n");
    }
  } catch (error) {
    $("status").textContent = own.signal.aborted ? "검색 취소됨" : "검색 실패";
    if (!own.signal.aborted)
      $("error").textContent =
        `${error.message} — Bybit의 지역 제한, CORS 또는 네트워크 정책을 확인하세요. README의 대안을 참고하세요.`;
  } finally {
    if (controller === own) {
      $("scan").disabled = false;
      $("cancel").disabled = true;
    }
  }
};
render();
