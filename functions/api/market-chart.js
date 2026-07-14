// /api/market-chart — 即時大盤報價（台指/櫃買/美指）
// 台股：TWSE MIS 即時系統（userDelay 5 秒，比 Yahoo 快很多）
// 美股指數：Yahoo Finance chart（非盤中時段返回最近收盤）

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// TWSE MIS 即時指數
async function fetchTwseIndex(exCh) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Referer': 'https://mis.twse.com.tw/' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const row = j?.msgArray?.[0];
    if (!row) return null;
    const current = parseFloat(row.z);
    const prev = parseFloat(row.y);
    const open = parseFloat(row.o);
    const high = parseFloat(row.h);
    const low = parseFloat(row.l);
    if (!isFinite(current) || current <= 0) return null;
    const change = current - prev;
    const changePct = prev > 0 ? (change / prev * 100) : null;
    return {
      name: row.n,
      current,
      prev,
      open,
      high,
      low,
      change,
      changePct,
      time: row.t || null,
      date: row.d || null,
      volume: row.m ? parseInt(row.m) : null,
    };
  } catch {
    return null;
  }
}

// Yahoo Finance chart API for indices (^GSPC, ^IXIC, ^SOX, etc.)
async function fetchYahooIndexLive(yahooSymbol) {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2d&interval=1d&events=div&includePrePost=false`;
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r) continue;
      const meta = r.meta || {};
      const closes = r.indicators?.quote?.[0]?.close || [];
      const prev = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose || meta.previousClose);
      const current = meta.regularMarketPrice || closes[closes.length - 1];
      if (!current) continue;
      const change = current - prev;
      const changePct = prev > 0 ? (change / prev * 100) : null;
      return {
        name: meta.longName || meta.shortName || yahooSymbol,
        current,
        prev,
        change,
        changePct,
        high: meta.regularMarketDayHigh || null,
        low: meta.regularMarketDayLow || null,
        open: null,
        time: null,
        date: null,
      };
    } catch {}
  }
  return null;
}

export async function onRequestGet(context) {
  const [taiex, otc, spx, ndx, sox] = await Promise.all([
    fetchTwseIndex('tse_t00.tw'),
    fetchTwseIndex('otc_o00.tw'),
    fetchYahooIndexLive('^GSPC'),
    fetchYahooIndexLive('^IXIC'),
    fetchYahooIndexLive('^SOX'),
  ]);

  return json({
    tw: {
      taiex: taiex ? { ...taiex, label: '台灣加權指數' } : null,
      otc: otc ? { ...otc, label: '櫃買指數' } : null,
    },
    us: {
      spx: spx ? { ...spx, label: 'S&P 500' } : null,
      ndx: ndx ? { ...ndx, label: 'Nasdaq' } : null,
      sox: sox ? { ...sox, label: '費半 SOX' } : null,
    },
  });
}

