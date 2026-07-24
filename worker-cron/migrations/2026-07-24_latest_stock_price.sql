-- market-flow.js／margin-ratio.js／active-etf-flow.js都各自對stock_daily_price做一次
-- 「MAX(date) per code」的全表join來查「每檔股票最新收盤價」，三處重複邏輯。改成一張
-- materialized表，由worker-cron每天寫入stock_daily_price時原地維護，讀取端單純SELECT即可。
CREATE TABLE IF NOT EXISTS latest_stock_price (
  code TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  close REAL,
  name TEXT
);

-- 一次性回填：從既有stock_daily_price算出每檔股票目前最新的一筆餵進新表，
-- 之後由cron每天寫入時原地維護，不需要再重跑這段。
INSERT OR REPLACE INTO latest_stock_price (code, date, close, name)
SELECT p.code, p.date, p.close, p.name
FROM stock_daily_price p
INNER JOIN (SELECT code, MAX(date) as max_date FROM stock_daily_price GROUP BY code) m
  ON p.code = m.code AND p.date = m.max_date;
