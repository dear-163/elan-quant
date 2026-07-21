import { saveSnapshot, loadSnapshotFallback } from '../_lib/kvSnapshot.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// 樣本數太小時勝率沒有統計意義（例如剛上線只有1、2筆），前端要能區分「還沒有足夠樣本」
// 跟「勝率就是這個數字」，不要讓使用者誤以為3戰3勝=100%勝率是穩定結論。
const MIN_SAMPLE_FOR_DISPLAY = 10;

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.ELAN_QUANT_DB) {
    return json({ error: 'D1 database binding (ELAN_QUANT_DB) not found.' }, 500);
  }

  try {
    const evaluatedRow = await env.ELAN_QUANT_DB
      .prepare('SELECT COUNT(*) as total, SUM(win) as wins FROM etf_signal_outcomes WHERE win IS NOT NULL')
      .first();
    const pendingRow = await env.ELAN_QUANT_DB
      .prepare('SELECT COUNT(*) as total FROM etf_signal_outcomes WHERE win IS NULL')
      .first();

    const evaluatedCount = evaluatedRow?.total || 0;
    const winCount = evaluatedRow?.wins || 0;
    const pendingCount = pendingRow?.total || 0;

    const result = {
      evaluatedCount,
      winCount,
      winRate: evaluatedCount > 0 ? Math.round((winCount / evaluatedCount) * 1000) / 10 : null,
      pendingCount,
      sufficientSample: evaluatedCount >= MIN_SAMPLE_FOR_DISPLAY,
      forwardTradingDays: 5,
    };

    context.waitUntil(saveSnapshot(env, 'etf-signal-winrate', result));
    return json(result);
  } catch (error) {
    const fallback = await loadSnapshotFallback(env, 'etf-signal-winrate');
    if (fallback) return json(fallback);
    return json({ error: `查詢ETF訊號勝率失敗：${error.message}` }, 500);
  }
}
