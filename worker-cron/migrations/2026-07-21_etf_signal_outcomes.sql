-- 每天記錄ETF加碼/減碼排行前5買超+前5賣超，之後回頭檢查這些訊號5個交易日後股價表現算勝率。
-- 動機與範圍限制見schema.sql同段註解。
CREATE TABLE IF NOT EXISTS etf_signal_outcomes (
  signal_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  action TEXT NOT NULL,
  signal_price REAL,
  outcome_price REAL,
  outcome_date TEXT,
  win INTEGER,
  PRIMARY KEY (signal_date, stock_code)
);
