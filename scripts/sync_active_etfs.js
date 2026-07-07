const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const target = process.argv.includes('--remote') ? '--remote' : '--local';

console.log(`Starting Active ETF holdings sync in ${target === '--remote' ? 'REMOTE' : 'LOCAL'} mode...`);

// Define seed data reflecting daily snapshots
const seedData = [
  // 2026-07-03
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2330', date: '2026-07-03', shares: 1000000, weight: 5.5 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '5347', date: '2026-07-03', shares: 800000, weight: 4.2 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2454', date: '2026-07-03', shares: 300000, weight: 3.8 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2330', date: '2026-07-03', shares: 1200000, weight: 6.2 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '5347', date: '2026-07-03', shares: 600000, weight: 3.1 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2454', date: '2026-07-03', shares: 350000, weight: 4.5 },

  // 2026-07-06 (Monday)
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2330', date: '2026-07-06', shares: 1050000, weight: 5.7 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '5347', date: '2026-07-06', shares: 780000, weight: 4.0 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2454', date: '2026-07-06', shares: 290000, weight: 3.6 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2330', date: '2026-07-06', shares: 1180000, weight: 6.0 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '5347', date: '2026-07-06', shares: 650000, weight: 3.3 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2454', date: '2026-07-06', shares: 360000, weight: 4.6 },

  // 2026-07-07 (Tuesday, Today)
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2330', date: '2026-07-07', shares: 1100000, weight: 6.0 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '5347', date: '2026-07-07', shares: 750000, weight: 3.8 },
  { etf_code: '00980A', etf_name: '野村臺灣智慧優選主動式ETF', stock_code: '2454', date: '2026-07-07', shares: 310000, weight: 3.9 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2330', date: '2026-07-07', shares: 1250000, weight: 6.5 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '5347', date: '2026-07-07', shares: 700000, weight: 3.6 },
  { etf_code: '00981A', etf_name: '統一臺灣主動成長動能ETF', stock_code: '2454', date: '2026-07-07', shares: 380000, weight: 4.8 }
];

const sqlStatements = seedData.map(d => {
  return `INSERT OR REPLACE INTO active_etf_holdings (etf_code, etf_name, stock_code, date, shares, weight) VALUES ('${d.etf_code}', '${d.etf_name}', '${d.stock_code}', '${d.date}', ${d.shares}, ${d.weight});`;
}).join('\n');

const tempSqlFile = path.join(__dirname, 'temp_sync.sql');
fs.writeFileSync(tempSqlFile, sqlStatements, 'utf8');

try {
  console.log('Writing seed data to D1...');
  const cmd = `npx wrangler d1 execute elan-quant-db ${target} --file="${tempSqlFile}"`;
  const output = execSync(cmd, { encoding: 'utf8' });
  console.log('D1 execution complete. Output:');
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
