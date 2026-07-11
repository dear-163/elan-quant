-- 情緒指數改用CNN Fear & Greed Index的7因子架構（台股對應資料源）。純 ADD COLUMN，不影響既有資料。
ALTER TABLE daily_market_data ADD COLUMN put_call_ratio REAL;
ALTER TABLE daily_market_data ADD COLUMN vixtwn REAL;
ALTER TABLE daily_market_data ADD COLUMN govbond_10y_yield REAL;
ALTER TABLE daily_market_data ADD COLUMN corp_bond_spread REAL;
