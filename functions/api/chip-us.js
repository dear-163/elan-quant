// US-market equivalent of chip.js. Taiwan's 融資融券/集保股權分散/三大法人 are TWSE/TDCC-specific —
// the US has no daily equivalent. Institutional ownership (SEC 13F) would require aggregating
// thousands of individual filers' holdings by CUSIP with no reliable free ticker-to-CUSIP crosswalk,
// and the only ready-made aggregation (FMP) gates it behind their Ultimate tier (~$149/mo) — not
// realistic for a free BYOK visitor, so that's deliberately out of scope here.
//
// Insider trading (SEC Form 4) IS practical: SEC EDGAR is free, requires no API key, and Form 4 is
// inherently per-company (no cross-filer aggregation needed). Fetched directly from data.sec.gov.
//
// Only transaction codes 'P' (open market/private purchase) and 'S' (open market/private sale) are
// counted — verified against SEC's own code table. Codes like 'A' (compensation grant), 'F' (tax
// withholding), 'M' (option/RSU exercise), 'G' (gift) are NOT discretionary trading decisions; a real
// AAPL filing inspected while building this had exactly 'M' and 'F' transactions from routine RSU
// vesting — counting those as "insider bought/sold" would have been a fabricated signal.
const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,15}$/;
const SEC_HEADERS = { 'User-Agent': 'LeCap/1.0 (le-cap.pages.dev, contact via GitHub)', 'Accept': 'application/json' };
const MAX_FILINGS = 20; // recent Form 4 filings to inspect per request — enough for a meaningful recent signal without excessive fetches

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } });
}

async function fetchRecentForm4Filings(cik) {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`SEC submissions HTTP ${res.status}`);
  const body = await res.json();
  const recent = body?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) throw new Error('SEC submissions 回應格式與預期不符');
  const filings = [];
  for (let i = 0; i < recent.form.length && filings.length < MAX_FILINGS; i++) {
    if (recent.form[i] !== '4') continue;
    filings.push({ accession: recent.accessionNumber[i], primaryDoc: recent.primaryDocument[i], date: recent.filingDate[i] });
  }
  return filings;
}

// The submissions API's primaryDocument often points at the XSL-rendered HTML view
// (xslF345X06/form4.xml) — the machine-readable raw XML is always at the accession root as
// "<accession>.xml" style naming; verified by inspecting a real filing directory listing.
async function fetchForm4Transactions(cik, accession) {
  const noDash = accession.replace(/-/g, '');
  const cikNum = parseInt(cik, 10);
  const res = await fetch(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${noDash}/${accession}.xml`, { headers: { ...SEC_HEADERS, 'Accept': 'application/xml' } });
  if (!res.ok) return [];
  const xml = await res.text();
  const transactions = [];
  // Minimal, dependency-free XML field extraction — Form 4's schema is stable and well-documented,
  // and we only need three fields per non-derivative transaction (open-market buys/sells only live
  // in <nonDerivativeTransaction>, not the derivative table).
  const txBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || [];
  for (const block of txBlocks) {
    const codeMatch = block.match(/<transactionCode>([^<]*)<\/transactionCode>/);
    const sharesMatch = block.match(/<transactionShares>\s*<value>([^<]*)<\/value>/);
    const adMatch = block.match(/<transactionAcquiredDisposedCode>\s*<value>([^<]*)<\/value>/);
    const dateMatch = block.match(/<transactionDate>\s*<value>([^<]*)<\/value>/);
    const code = codeMatch?.[1];
    if (code !== 'P' && code !== 'S') continue; // only genuine open-market trades — see file header note
    const shares = parseFloat(sharesMatch?.[1]);
    if (!isFinite(shares)) continue;
    transactions.push({ code, shares, acquiredDisposed: adMatch?.[1], date: dateMatch?.[1] });
  }
  return transactions;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return json({ error: '股票代號格式不正確' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://elan-quant-cache.internal/chip-us/${symbol}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let insider;
  try {
    // Ticker->CIK mapping, cached separately (long TTL) from the per-symbol result below.
    const tickerCacheKey = new Request('https://elan-quant-cache.internal/sec-tickers', { method: 'GET' });
    let tickerBody;
    const tickerCached = await cache.match(tickerCacheKey);
    if (tickerCached) {
      tickerBody = await tickerCached.json();
    } else {
      const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS });
      if (!res.ok) throw new Error(`SEC company_tickers.json HTTP ${res.status}`);
      tickerBody = await res.json();
      const tickerResponse = json(tickerBody, 200, { 'Cache-Control': 'public, max-age=86400' });
      context.waitUntil(cache.put(tickerCacheKey, tickerResponse.clone()));
    }
    const entry = Object.values(tickerBody).find(v => v.ticker === symbol);
    if (!entry) {
      insider = { error: `SEC EDGAR 找不到股票代號 ${symbol} 對應的公司（可能非美股上市公司）` };
    } else {
      const cik = String(entry.cik_str).padStart(10, '0');
      const filings = await fetchRecentForm4Filings(cik);
      if (filings.length === 0) {
        insider = { error: `SEC EDGAR 近期無 ${symbol} 的 Form 4（內部人交易）申報紀錄` };
      } else {
        const allTx = (await Promise.all(filings.map(f => fetchForm4Transactions(cik, f.accession)))).flat();
        const source = `SEC EDGAR Form 4（近${filings.length}筆申報，僅計入代碼P/S的公開市場買賣，不含選擇權履約/稅務代扣/獎勵歸屬等）`;
        const latestDate = filings[0]?.date || null;
        if (allTx.length === 0) {
          insider = {
            totalBought: { value: 0, source, date: latestDate },
            totalSold: { value: 0, source, date: latestDate },
            netShares: { value: 0, source, date: latestDate },
            note: '近期申報中沒有公開市場買賣交易（可能都是獎勵歸屬、稅務代扣等非交易性質的申報）',
          };
        } else {
          const bought = allTx.filter(t => t.code === 'P').reduce((s, t) => s + t.shares, 0);
          const sold = allTx.filter(t => t.code === 'S').reduce((s, t) => s + t.shares, 0);
          insider = {
            totalBought: { value: bought, source, date: latestDate },
            totalSold: { value: sold, source, date: latestDate },
            netShares: { value: bought - sold, source, date: latestDate },
          };
        }
      }
    }
  } catch (e) {
    // SEC EDGAR (Akamai前端) 對於429/403會回傳「Request Rate Threshold Exceeded」——實測發現
    // 就算完全遵守SEC官方要求的User-Agent格式、且本站對這個端點有24小時快取（正常情況下
    // 請求量極低），仍會持續被擋。研判是Cloudflare大量網站共用的出口IP整體流量觸發了SEC那邊
    // 的存取限制，不是本站自己請求過量——跟本session先前遇到的TWSE MIS/TPEx公債殖利率
    // 同一類「來源端對雲端平台IP的限制」，程式碼層面無法修復，只能誠實告知原因。
    const blocked = /HTTP (403|429|503)/.test(e.message);
    insider = blocked
      ? { error: 'SEC EDGAR 目前暫時無法取用（美國證管會網站對雲端平台共用IP的存取有限制，並非本站故障，之後可能自行恢復，建議稍後再試）' }
      : { error: `SEC EDGAR 請求發生例外：${e.message}` };
  }

  const gotRealData = !insider.error;
  const response = json({ insider }, 200, gotRealData ? { 'Cache-Control': 'public, max-age=3600' } : {});
  if (gotRealData) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
