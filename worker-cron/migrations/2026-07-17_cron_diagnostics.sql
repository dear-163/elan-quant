-- 每個排程步驟最近一次執行結果的輕量診斷表，動機見schema.sql同段註解——
-- 公債殖利率那個步驟連續252天失敗都沒人發現，因為失敗訊息只存在Cloudflare log裡。
CREATE TABLE IF NOT EXISTS cron_diagnostics (
  step TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);
