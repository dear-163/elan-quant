-- active_etf_holdings.shares 從 NOT NULL 改為可為 NULL（國泰投信等只揭露權重、不揭露股數的
-- 發行公司需要）。SQLite 不支援直接 ALTER COLUMN 移除 NOT NULL，改用「建新表→搬資料→刪舊表→
-- 改名」的標準做法。同時新增 etf_portfolio_value 表（純新增，不影響既有資料）。

CREATE TABLE active_etf_holdings_new (
  etf_code TEXT NOT NULL,
  etf_name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  date TEXT NOT NULL,
  shares INTEGER,
  weight REAL NOT NULL,
  PRIMARY KEY (etf_code, stock_code, date)
);

INSERT INTO active_etf_holdings_new (etf_code, etf_name, stock_code, date, shares, weight)
  SELECT etf_code, etf_name, stock_code, date, shares, weight FROM active_etf_holdings;

DROP TABLE active_etf_holdings;
ALTER TABLE active_etf_holdings_new RENAME TO active_etf_holdings;

CREATE INDEX IF NOT EXISTS idx_active_etf_holdings_stock_date ON active_etf_holdings(stock_code, date);
CREATE INDEX IF NOT EXISTS idx_active_etf_holdings_etf_date ON active_etf_holdings(etf_code, date);

CREATE TABLE IF NOT EXISTS etf_portfolio_value (
  etf_code TEXT NOT NULL,
  date TEXT NOT NULL,
  stock_value REAL NOT NULL,
  PRIMARY KEY (etf_code, date)
);
