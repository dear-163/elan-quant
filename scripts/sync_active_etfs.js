const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const target = process.argv.includes('--remote') ? '--remote' : '--local';
const dateArgIdx = process.argv.indexOf('--date');
let todayDate = '';

if (dateArgIdx !== -1 && process.argv[dateArgIdx + 1]) {
  todayDate = process.argv[dateArgIdx + 1];
} else {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = taipei.getUTCFullYear();
  const m = String(taipei.getUTCMonth() + 1).padStart(2, '0');
  const d = String(taipei.getUTCDate()).padStart(2, '0');
  todayDate = `${y}-${m}-${d}`;
}

console.log(`Starting live Active ETF holdings crawler & sync for date ${todayDate} (${target === '--remote' ? 'REMOTE' : 'LOCAL'})...`);

const etfs = [
  { code: '00981A', name: '主動統一台股增長主動式ETF', moneydjCode: '00981A.TW' },
  { code: '00980A', name: '野村臺灣智慧優選主動式ETF', moneydjCode: '00980A.TW' }
];

async function main() {
  const sqlCommands = [];

  for (const etf of etfs) {
    try {
      console.log(`Fetching constituents for ${etf.code} from MoneyDJ...`);
      const url = `https://www.moneydj.com/etf/x/basic/basic0007.xdjhtm?etfid=${etf.moneydjCode}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) {
        throw new Error(`MoneyDJ HTTP ${res.status}`);
      }
      const html = await res.text();
      const regex = /etfid=(\d{4,6})\.(TW|TWO)[^>]*>([^<\(]+)\(\1\.\2\)<\/a><\/td><td[^>]*>([0-9.]+)<\/td><td[^>]*>([0-9,.-]+)<\/td>/gi;

      let match;
      let count = 0;
      while ((match = regex.exec(html)) !== null) {
        const stockCode = match[1];
        const weight = parseFloat(match[4]);
        const shares = parseFloat(match[5].replace(/,/g, ''));
        
        sqlCommands.push(
          `INSERT OR REPLACE INTO active_etf_holdings (etf_code, etf_name, stock_code, date, shares, weight) VALUES ('${etf.code}', '${etf.name}', '${stockCode}', '${todayDate}', ${shares}, ${weight});`
        );
        count++;
      }
      console.log(`Parsed ${count} constituents for ${etf.code}`);
    } catch (e) {
      console.error(`Error crawling ${etf.code}:`, e.message);
    }
  }

  if (sqlCommands.length === 0) {
    console.log('No holdings crawled. Exiting.');
    return;
  }

  const tempSqlFile = path.join(__dirname, 'temp_sync.sql');
  fs.writeFileSync(tempSqlFile, sqlCommands.join('\n'), 'utf8');

  try {
    console.log('Executing SQL statements in D1...');
    const cmd = `npx wrangler d1 execute elan-quant-db ${target} --file="${tempSqlFile}"`;
    const output = execSync(cmd, { encoding: 'utf8' });
    console.log('D1 execution complete.');
    console.log(output);
  } catch (e) {
    console.error('Error executing seed data:', e.message);
    if (e.stdout) console.log('Stdout:', e.stdout);
    if (e.stderr) console.error('Stderr:', e.stderr);
  } finally {
    if (fs.existsSync(tempSqlFile)) {
      fs.unlinkSync(tempSqlFile);
    }
  }
  console.log('Sync complete.');
}

main();
