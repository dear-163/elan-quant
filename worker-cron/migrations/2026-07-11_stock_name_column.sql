-- stock_daily_price 新增 name 欄位（股票中文名稱），來自 TWSE/TPEx 官方每日資料本身
-- 就有的 Name/CompanyName 欄位（之前抓取時被忽略掉了），用來取代 active-etf-flow.js
-- 裡容易漏掉冷門股票的靜態 STOCK_NAMES 對照表。純 ADD COLUMN，不影響既有資料。
ALTER TABLE stock_daily_price ADD COLUMN name TEXT;
