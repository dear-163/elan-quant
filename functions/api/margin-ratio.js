// 台股大盤融資使用率 = 全市場融資今日餘額 ÷ 全市場融資限額 × 100%
// 這是「整個市場有多少融資額度被用掉」的槓桿/投機熱度量尺，不是融資維持率（現有部位
// 離斷頭多近）——兩者是不同的問題，維持率低不代表槓桿多，使用率高才是。
// 資料來源：TWSE 信用交易統計表的個股明細（tables[1]），每一列本來就同時有「融資今日
// 餘額」跟「次一營業日限額」兩欄，市場加總兩欄相除即可，不需要另外查股價或用到D1。
import { saveSnapshot, loadSnapshotFallback } from '../_lib/kvSnapshot.js';

const BROWSER_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Referer': 'https://www.twse.com.tw/',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function toAdDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
function isoFromAd(s) {
  return s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}
function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

async function fetchMarginTradingForDate(adDate) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${adDate}&selectType=ALL`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (body && body.stat === 'OK' && Array.isArray(body.tables) && body.tables.length >= 2) {
    return body;
  }
  return null;
}

function computeUsageRatio(body) {
  const detailTable = body.tables[1];
  const rows = detailTable.data || [];
  let totalBalance = 0, totalLimit = 0, matchedStocks = 0;
  for (const row of rows) {
    const code = (row[0] || '').trim();
    const balanceLots = parseNum(row[6]); // 融資今日餘額，單位「張」
    const limitLots = parseNum(row[7]); // 次一營業日限額，單位「張」
    if (!code || balanceLots == null || limitLots == null || limitLots <= 0) continue;
    totalBalance += balanceLots;
    totalLimit += limitLots;
    matchedStocks++;
  }
  if (matchedStocks === 0 || totalLimit === 0) return null;
  return {
    ratio: Math.round((totalBalance / totalLimit) * 100 * 100) / 100,
    totalBalance,
    totalLimit,
    matchedStocks,
  };
}

// 使用率（餘額÷限額）的分母是監理限額，加總起來遠大於實際餘額規模（限額約2.5億張，
// 餘額長年只有6~9百萬張），導致比例結構性地卡在3%~4%這個窄幅區間，不管市場實際上是熱
// 是冷都看不太出差異——單看這個%數字沒有「現在算高還是低」的參照點。worker-cron每天
// 已經把全市場融資餘額（不同來源：openapi.twse.com.tw，跟這裡即時抓的rwd端點數值會有
// 些微落差但同樣量級，足夠拿來排百分位）存進D1 daily_market_data.margin_balance_total
// 超過一年。
//
// 一開始直接拿「餘額原始水位」排252個交易日的百分位，但實測發現融資餘額過去14個月幾乎
// 單調上升（2025-06月均677萬張 → 2026-07月均953萬張，沒有明顯回落），這種長期趨勢會讓
// 原始水位百分位失真——只要餘額還在漲，最近的日子幾乎必然落在歷史高百分位，這只是反映
// 「餘額還在漲」，不是「今天散戶特別衝動」，拿這個當「熱不熱」的判斷基準並不公正。
// 改成「今天餘額 ÷ 近TREND_MA_WINDOW個交易日移動平均」這個比值去排百分位——先用移動
// 平均把長期趨勢濾掉，只留下「今天偏離自己近期正常水準多少」，才是真正回答「現在算不算
// 異常熱」的公平算法（historical序列的每一天也用同樣的「該天÷該天之前MA_WINDOW天均值」
// 算法，才是同一把尺互相比較，不是拿去趨勢化的今天比未去趨勢化的歷史）。
const PERCENTILE_MIN_HISTORY = 60; // 去趨勢化後的比值序列至少要有60筆才顯示百分位（沿用sentiment.js同樣的門檻）
const PERCENTILE_WINDOW = 252;
const TREND_MA_WINDOW = 20; // 近20個交易日（約1個月）移動平均，當作「近期正常水準」基準

async function fetchMarginBalancePercentile(env, todayBalance) {
  if (!env.ELAN_QUANT_DB) return null;
  try {
    const rows = await env.ELAN_QUANT_DB
      .prepare('SELECT margin_balance_total FROM daily_market_data WHERE margin_balance_total IS NOT NULL ORDER BY date DESC LIMIT ?')
      .bind(PERCENTILE_WINDOW + TREND_MA_WINDOW)
      .all();
    // D1回傳新到舊，反轉成舊到新方便往前算移動平均
    const balances = (rows.results || []).map(r => r.margin_balance_total).filter(v => v != null).reverse();
    if (balances.length < TREND_MA_WINDOW + PERCENTILE_MIN_HISTORY) {
      return { percentile: null, historyDays: Math.max(0, balances.length - TREND_MA_WINDOW) };
    }

    const ratios = [];
    for (let i = TREND_MA_WINDOW; i < balances.length; i++) {
      const ma = balances.slice(i - TREND_MA_WINDOW, i).reduce((s, v) => s + v, 0) / TREND_MA_WINDOW;
      ratios.push(balances[i] / ma);
    }

    const todayMa = balances.slice(-TREND_MA_WINDOW).reduce((s, v) => s + v, 0) / TREND_MA_WINDOW;
    const todayRatio = todayBalance / todayMa;

    const below = ratios.filter(r => r <= todayRatio).length;
    return { percentile: Math.round((below / ratios.length) * 100), historyDays: ratios.length };
  } catch {
    return null; // 百分位只是輔助資訊，D1查詢失敗不該讓整個使用率API跟著掛掉
  }
}

// TWSE這個端點本身就支援指定歷史日期查詢（date=YYYYMMDD），不需要另外存D1累積歷史——
// 跟原本「只抓最新一天，往回找到有效資料為止」是同一種寫法，差別只在於找滿N天才停，不是
// 找到1天就停。掃描上限抓寬一點（連假很少連續超過一週）。
const HISTORY_DAYS = 3;
const MAX_SCAN_ATTEMPTS = 20;

async function fetchRecentMarginTradingDays(n) {
  const cursor = new Date();
  const results = [];
  for (let attempts = 0; attempts < MAX_SCAN_ATTEMPTS && results.length < n; attempts++) {
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) { cursor.setUTCDate(cursor.getUTCDate() - 1); continue; }
    const adDate = toAdDate(cursor);
    const body = await fetchMarginTradingForDate(adDate);
    if (body) {
      const usage = computeUsageRatio(body);
      if (usage) results.push({ date: isoFromAd(body.date || adDate), ...usage });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return results; // 新到舊排序
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const days = await fetchRecentMarginTradingDays(HISTORY_DAYS);
    if (days.length === 0) {
      // 丟例外而不是直接return——這樣才會進到下面catch區塊試KV快照回退，不然TWSE
      // 這端點暫時失敗時，卡片會直接消失、沒有任何錯誤訊息（跟market-flow.js同一類bug）。
      throw new Error('近期交易日的 TWSE 信用交易統計（融資融券餘額）皆無法取得有效資料，請稍後再試');
    }

    const latest = days[0];
    const percentileInfo = await fetchMarginBalancePercentile(env, latest.totalBalance);
    const result = {
      date: latest.date,
      source: 'TWSE 信用交易統計（融資融券餘額，個股明細加總）',
      ratio: latest.ratio,
      totalBalance: latest.totalBalance,
      totalLimit: latest.totalLimit,
      matchedStocks: latest.matchedStocks,
      // 舊到新排序，方便前端直接畫成由左到右的比較列
      history: days.slice().reverse().map(d => ({ date: d.date, ratio: d.ratio })),
      balancePercentile: percentileInfo?.percentile ?? null,
      balancePercentileHistoryDays: percentileInfo?.historyDays ?? null,
    };
    context.waitUntil(saveSnapshot(env, 'margin-ratio', result));
    return json(result);
  } catch (error) {
    const fallback = await loadSnapshotFallback(env, 'margin-ratio');
    if (fallback) return json(fallback);
    return json({ error: `查詢台股融資使用率失敗：${error.message}` }, 500);
  }
}
