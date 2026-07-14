// /api/market-chart — 代理台指/美指 歷史K線給首頁用
// 直接重用 quote.js 的 Yahoo Finance 代理邏輯，僅限特定 symbol 白名單

const BROWSER_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

const ALLOWED_SYMBOLS = {
  'TWII': '^TWII',      // 台灣加權指數
  'SPX': '^GSPC',       // S&P 500
  'NDX': '^IXIC',       // Nasdaq Composite
  'DJI': '^DJI',        // Dow Jones
  'SOX': '^SOX',        // 費城半導體
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', ...extraHeaders },
  });
}

async function fetchYahooCandles(yahooSymbol, range, interval) {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const target = `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}&events=div&includePrePost=false`;
      const res = await fetch(target, { headers: BROWSER_HEADERS });
      if (!res.ok) continue;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r?.timestamp) continue;
      const ts = r.timestamp;
      const q = r.indicators?.quote?.[0];
      if (!q) continue;
      const meta = r.meta || {};
      const candles = ts.map((t, i) => ({
        t: t * 1000,
        o: q.open?.[i],
        h: q.high?.[i],
        l: q.low?.[i],
        c: q.close?.[i],
      })).filter(d => d.c != null && d.c > 0);
      if (candles.length < 5) continue;
      return {
        candles,
        meta: {
          latestClose: meta.regularMarketPrice || candles[candles.length - 1]?.c,
          previousClose: meta.chartPreviousClose || meta.previousClose,
          longName: meta.longName || meta.shortName || yahooSymbol,
        }
      };
    } catch {}
  }
  return null;
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const sym = (url.searchParams.get('symbol') || 'TWII').toUpperCase().trim();
  const range = url.searchParams.get('range') || '3mo';
  const VALID_RANGES = ['1mo', '3mo', '6mo', '1y', '2y'];
  if (!VALID_RANGES.includes(range)) return json({ error: 'invalid range' }, 400);

  const yahooSym = ALLOWED_SYMBOLS[sym];
  if (!yahooSym) return json({ error: 'symbol not supported' }, 400);

  const interval = (range === '2y') ? '1wk' : '1d';
  const data = await fetchYahooCandles(yahooSym, range, interval);
  if (!data) return json({ error: '無法取得指數資料' }, 502);

  return json({ symbol: sym, range, interval, ...data });
}
