import { test, expect } from "@playwright/test";
const step = 900000;
function candles() {
  const start = Math.floor(Date.now() / step) * step - 102 * step;
  const bars = Array.from({ length: 101 }, (_, i) => [
    String(start + i * step),
    "98",
    "99",
    "97",
    "98",
    "100",
    "1000",
  ]);
  for (const i of [55, 75]) bars[i][2] = "100";
  bars[100] = [
    String(start + 100 * step),
    "99",
    "102.2",
    "98.8",
    "102",
    "250",
    "1000",
  ];
  bars.push([
    String(start + 101 * step),
    "100.1",
    "103",
    "99.9",
    "102.8",
    "100",
    "1000",
  ]);
  return bars.reverse();
}
async function mock(page) {
  await page.route("https://api.bybit.com/**", async (route) => {
    const url = route.request().url();
    const result = url.includes("instruments-info")
      ? {
          list: [
            {
              symbol: "TESTUSDT",
              status: "Trading",
              contractType: "LinearPerpetual",
              quoteCoin: "USDT",
              settleCoin: "USDT",
            },
          ],
        }
      : url.includes("tickers")
        ? { list: [{ symbol: "TESTUSDT", turnover24h: "12000000" }] }
        : url.includes("open-interest")
          ? { list: [] }
          : { list: candles() };
    await route.fulfill({ json: { retCode: 0, result } });
  });
}
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`scan, filters and chart at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "검색 시작" }).click();
    await expect(page.locator("#status")).toHaveText("검색 완료");
    await expect(page.locator("#entries .card")).toHaveCount(1);
    await expect(page.locator("#entries")).toContainText("ENTRY_LONG");
    await expect(page.locator("#stats")).toContainText("성공 1");
    await expect(
      page.getByRole("link", { name: "TradingView 차트" }),
    ).toHaveAttribute("href", /BYBIT%3ATESTUSDT.P/);
    await expect(
      page.locator("#entries dt").filter({ hasText: /^목표$/ }),
    ).toHaveCount(1);
    await expect(
      page.locator("#entries dt").filter({ hasText: /1차|2차/ }),
    ).toHaveCount(0);
    await page.locator("#rr").selectOption("2");
    await expect(page.locator(".card")).toHaveCount(0);
    await page.locator("#rr").selectOption("0");
    const chart = page.locator("#entries .chart-canvas");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-ready", "true");
    await expect(chart.locator("canvas").first()).toBeVisible();
    await expect(page.locator("#entries .chart-legend")).toContainText(
      "리테스트",
    );
    await page.screenshot({
      path: `test-results/inline-chart-${viewport.width}.png`,
      fullPage: true,
    });
    await page.locator("#state").selectOption("WAIT_RETEST");
    await expect(page.locator(".card")).toHaveCount(0);
    await page.locator("#state").selectOption("ALL");
    await expect(page.locator(".card")).toHaveCount(1);
    await page.locator("#entries .chart-canvas").scrollIntoViewIfNeeded();
    await expect(page.locator("#entries .chart-canvas")).toHaveAttribute(
      "data-ready",
      "true",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/scanner-${viewport.width}.png`,
      fullPage: true,
    });
  });
test("cancel and rescan without stale results", async ({ page }) => {
  await page.route("https://api.bybit.com/**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "검색 시작" }).click();
  await page.getByRole("button", { name: "검색 취소" }).click();
  await expect(page.locator("#status")).toHaveText("검색 취소됨");
  await expect(page.locator("#scan")).toBeEnabled();
  await page.unrouteAll();
  await mock(page);
  await page.locator("#scan").click();
  await expect(page.locator("#status")).toHaveText("검색 완료");
});
test("network failure is visible", async ({ page }) => {
  await page.route("https://api.bybit.com/**", (route) =>
    route.fulfill({ status: 403, body: "Blocked" }),
  );
  await page.goto("/");
  await page.locator("#scan").click();
  await expect(page.locator("#error")).toContainText("HTTP 403", {
    timeout: 15000,
  });
});

for (const width of [1440, 390])
  test(`market selection limits requests and replaces results at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const assets = [
      ["BTCUSDT", ""], ["NEWUSDT", "innovation"], ["AAPLUSDT", "stock"],
      ["ETFUSDT", "ETF"], ["GOLDUSDT", "commodity"], ["EURUSDT", "forex"],
      ["UNKNOWNUSDT", "new-type"], ["MISSINGUSDT", undefined],
    ];
    const requested = new Set();
    await page.route("https://api.bybit.com/**", async route => {
      const url = new URL(route.request().url());
      let result;
      if (url.pathname.endsWith("instruments-info")) {
        const second = url.searchParams.has("cursor");
        result = {
          list: (second ? assets.slice(2) : assets.slice(0, 2)).map(([symbol, symbolType]) => ({
            symbol, symbolType, status: "Trading", contractType: "LinearPerpetual", quoteCoin: "USDT", settleCoin: "USDT",
          })), nextPageCursor: second ? "" : "page2",
        };
      } else if (url.pathname.endsWith("tickers")) {
        result = { list: assets.map(([symbol]) => ({ symbol, turnover24h: "12000000" })) };
      } else if (url.pathname.endsWith("open-interest")) result = { list: [] };
      else { requested.add(url.searchParams.get("symbol")); result = { list: candles() }; }
      await route.fulfill({ json: { retCode: 0, result } });
    });
    await page.goto("/");
    const market = page.getByRole("combobox", { name: /^탐색 시장/ });
    await expect(market).toHaveValue("all");
    for (const [selection, expected] of [
      ["stock", ["AAPLUSDT"]],
      ["crypto", ["BTCUSDT", "NEWUSDT"]],
      ["all", assets.map(([symbol]) => symbol)],
    ]) {
      requested.clear();
      await market.selectOption(selection);
      await page.locator("#scan").click();
      await expect(page.locator("#status")).toHaveText("검색 완료");
      expect([...requested].sort()).toEqual([...expected].sort());
      await expect(page.locator("#stats")).toContainText(`전체 ${expected.length} · 완료 ${expected.length} · 성공 ${expected.length}`);
      await expect(page.locator("#entries .card")).toHaveCount(expected.length);
      expect(await page.locator("#entries h3").allTextContents()).toEqual(expect.arrayContaining(expected));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/market-${width}.png`, fullPage: true });
  });
