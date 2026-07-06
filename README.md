# Élan Quant

即時技術分析（Yahoo Finance／FMP／TWSE／TPEx）+ Gemini AI 基本面分析網路 App。前端為純靜態頁面，`/api/*` 由 Cloudflare Pages Functions 代管。

- **技術分析**（價格、K線、RSI/MACD/KD/布林通道等）：訪客不需要任何 Key，開箱即用。
- **AI 分析**（基本面／估值／風險／結論）：訪客必須自己填一組免費的 Gemini API Key（見下方「BYOK」），金鑰只存在訪客自己的瀏覽器裡，直接從瀏覽器呼叫 Google，完全不經過本站伺服器，也不會用到站方的任何額度。這個設計是刻意的——Gemini 免費方案的每日額度非常低（例如 `gemini-3.5-flash` 一個 Google 專案一天只有 20 次請求，一次完整分析就要打 4 次），如果由站方代管單一 Key 給所有訪客共用，額度一下就會被打爆，所以不提供「不填 Key 也能用 AI 分析」的預設路徑。

## 專案結構

```
public/            靜態前端（index.html / styles.css / app.js）
functions/api/
  quote.js         GET /api/quote?symbol=&period=          伺服器端抓 Yahoo/FMP/TWSE/TPEx 股價與基本面數據，含 45 秒邊緣快取
  ground.js        GET /api/ground?symbol=&section=         查 FMP 真實財報/同業數據，餵給 Gemini prompt 避免 AI 憑空編數字（不呼叫 Gemini，不需要 Gemini Key）
wrangler.toml      Cloudflare Pages 專案設定
```

## 本機開發

```bash
npm install -g wrangler   # 若尚未安裝
cp .dev.vars.example .dev.vars   # 選填：站方自己的 FMP_KEY，補充美股財報數據
wrangler pages dev public
```

開啟終端機顯示的網址（預設 http://localhost:8788）。技術分析可直接測試；AI 分析要在頁面上「🔑 設定你的 Gemini API Key」面板填入你自己的 Key 才能使用。

## 部署到 Cloudflare Pages

1. 推到 GitHub。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，選這個 repo。
   - Build command：留空（純靜態，無需 build）
   - Build output directory：`public`
3. 選填：在 Pages 專案 Settings → Environment variables 新增加密 Secret `FMP_KEY`（站方自己的 FMP Key，補充美股財報數據／`/api/ground` 的真實數據來源；訪客也可以自己填 FMP Key 覆蓋，見下方 BYOK）。
4. 觸發部署（push 到 main 分支即會自動 build & 部署）。

不需要設定 `GEMINI_API_KEY`、不需要建立 KV namespace——AI 分析走訪客自己的 Key 直連 Google，站方不需要代管任何 Gemini 額度。

## Yahoo quoteSummary/v7 的 cookie + crumb

Yahoo 從某個時間點起把 `quoteSummary`／`v7 quote` 這兩支非官方 API 鎖起來，沒帶正確的 session cookie + crumb 一律回 401（跟 yfinance 這類套件近期得處理的問題一樣）。`quote.js` 的 `getYahooCrumb()`：

1. GET `https://fc.yahoo.com` 拿一組 session cookie（回應本身可能是 404，但 `Set-Cookie` header 有效）。
2. 帶著這組 cookie GET `https://query2.finance.yahoo.com/v1/test/getcrumb` 換一個 crumb 字串。
3. 之後所有 quoteSummary/v7 請求都帶上 `Cookie` header 與 `&crumb=`。

crumb+cookie 若有綁定 KV 會快取起來（20 分鐘 TTL，binding 名稱 `RATE_LIMIT_KV`，選填——沒綁定的話每次都會重新換一次 cookie/crumb，只是稍慢，不影響功能）。**這是非官方繞過手法，Yahoo 隨時可能改版讓它失效**——所以 `.TW`／`.TWO` 保留 TWSE／TPEx 官方開放資料當第二層備援（見下方），兩者都失敗才會落到 stooq、最後才是「只有K線」。

如果想啟用 crumb 快取：Pages 專案 Settings → Functions → KV namespace bindings → 建立/綁定一個叫 `RATE_LIMIT_KV` 的 namespace 即可，純屬效能優化，非必要。

## 台股基本面數據來源（Yahoo 失效時的備援）

`.TW`（上市）／`.TWO`（上櫃）在 Yahoo cookie+crumb 失敗時，改用官方免費、免金鑰的政府開放資料 API：

- **.TW**：`openapi.twse.com.tw` 的 `STOCK_DAY_AVG_ALL`（股價）＋ `BWIBBU_ALL`（本益比／殖利率／股價淨值比）。
- **.TWO**：`www.tpex.org.tw/openapi` 的 `tpex_mainboard_daily_close_quotes`（股價）＋ `tpex_mainboard_peratio_analysis`（本益比／殖利率／股價淨值比）。

這兩個備援只給股價＋PE／殖利率／PBR，沒有市值、EPS、Beta、分析師評級、產業別（沒有現成免金鑰端點），正常情況下用不到，因為 Yahoo 那條路線會先給到完整資料。

## FMP API 版本注意事項

FMP 已於 2025-08-31 全面關閉 `/api/v3/`、`/api/v4/` 端點（非舊制帳號一律回傳 403 "Legacy Endpoint"），本專案一律改用 `/stable/` 端點（`?symbol=` query param，而非路徑參數）。若之後要新增其他 FMP 端點，記得確認是走 `/stable/` 而非文件裡到處還看得到的舊版 `/api/v3/` 範例。

## BYOK（訪客自帶 API Key）

前端頁面的「🔑 設定你的 Gemini API Key」面板讓訪客填自己的 Key，存在瀏覽器 localStorage：

- **Gemini Key（必填）**：AI 分析一律直接從瀏覽器呼叫 `generativelanguage.googleapis.com`，金鑰不會經過本站伺服器，費用/額度算在訪客自己的 Google 帳號。相關 prompt 文字只存在 `public/app.js` 的 `PROMPT_SECTIONS`（沒有後端副本，因為 Gemini 呼叫已經沒有後端路徑了）。
- **FMP Key（選填）**：填了之後會以 `&fmpKey=` 帶到 `/api/quote` 與 `/api/ground`，優先於站方的 `FMP_KEY`（僅該次請求使用，不會被記錄或儲存在伺服器）。沒填就用站方的 `FMP_KEY`（如果有設定的話）。

## 基本面數據補強（避免 AI 憑空推論財報數字）

Gemini 本身不會即時查財報，`基本面分析／估值` 這兩段如果只丟技術面摘要進去，AI 可能會用自己的訓練知識「腦補」近3年財務趨勢與同業比較的具體數字，不保證正確。`functions/api/ground.js` 在有 FMP Key（站方或訪客提供）且為美股代號時，會額外查真實數據，前端再把這段文字附加到送給 Gemini 的 prompt 後面：

- **fundamentals** 段：查 FMP `income-statement`（近3年，年度），把真實營收/淨利/毛利率/營業利益率/淨利率整理成文字，要求 Gemini 優先採用、不得自行編造不同數字。
- **valuation** 段：查 FMP `stock-peers` 找出2-3家同業，再查其本益比/市值，同樣要求 Gemini 直接使用真實數字建表。
- 若無 FMP Key、代號非美股，或 FMP 請求失敗，會改為附加一句指示，要求 Gemini 在報告中明確註明該段落是「一般產業知識推論」，而非查證數字——避免使用者誤把推論當成即時查證的財報。

這支端點不呼叫 Gemini、不需要 Gemini Key，純粹回傳一段文字，所以跟訪客要不要 BYOK Gemini 無關，一律都會套用。

## Gemini 3.x 的 thinking tokens

`gemini-3.5-flash`／`gemini-3.5-pro` 是會「思考」的模型，`maxOutputTokens` 的額度會被隱藏的推理過程（`thoughtsTokenCount`）吃掉一部分，才輪到真正要顯示的文字。目前設定 `maxOutputTokens: 4096` 搭配 `generationConfig.thinkingConfig.thinkingLevel: 'low'`（壓低思考程度，把額度留給輸出內容）。如果之後又出現回應被截斷（`finishReason: "MAX_TOKENS"`），先檢查是不是這兩個值需要再往上調。

## 免責聲明

本工具僅供技術與資訊整理參考，不構成投資建議。
