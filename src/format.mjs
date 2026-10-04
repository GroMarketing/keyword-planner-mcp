const BARS = '▁▂▃▄▅▆▇█';

/** Monthly volumes as a one-line chart. */
export function sparkline(months = []) {
  const v = months.map((m) => m.volume);
  if (!v.length) return '';
  const max = Math.max(...v);
  const min = Math.min(...v);
  return v.map((x) => BARS[max === min ? 3 : Math.round(((x - min) / (max - min)) * 7)]).join('');
}

const pct = (n) => (n == null ? '' : `${n > 0 ? '+' : ''}${n}%`);
const money = (n) => (n == null ? '' : `$${n.toFixed(2)}`);
const num = (n) => (n == null ? '' : n.toLocaleString('en-US'));

const COLS = [
  ['keyword', (r) => r.keyword],
  ['volume/mo', (r) => (r.noData ? 'no data' : num(r.volume))],
  ['yoy', (r) => pct(r.yoy)],
  ['3mo', (r) => pct(r.change3)],
  ['last 12 months', (r) => sparkline((r.monthly || []).slice(-12))],
  ['peak', (r) => r.peak || ''],
  ['comp', (r) => (r.competitionIndex != null ? `${r.competition ?? ''} ${r.competitionIndex}`.trim() : r.competition || '')],
  ['top-of-page bid', (r) => (r.bidLow != null || r.bidHigh != null ? `${money(r.bidLow)}-${money(r.bidHigh)}` : '')],
];

/** Aligned plain-text table, readable in a terminal and in an MCP client. */
export function table(rows, { header = '' } = {}) {
  const cells = rows.map((r) => COLS.map(([, f]) => String(f(r))));
  const width = COLS.map(([h], i) => Math.max([...h].length, ...cells.map((c) => [...c[i]].length)));
  const line = (c) => c.map((x, i) => (i === 0 ? x.padEnd(width[i]) : x.padStart(width[i]))).join('  ').trimEnd();
  const out = [];
  if (header) out.push(header, '');
  out.push(line(COLS.map(([h]) => h)));
  for (const c of cells) out.push(line(c));
  const nodata = rows.filter((r) => r.noData).length;
  if (nodata) out.push('', `${nodata} keyword(s) have no data: Google has too few searches to report, which is not the same as zero.`);
  return out.join('\n');
}

export function csv(rows) {
  const months = [...new Set(rows.flatMap((r) => (r.monthly || []).map((m) => m.month)))].sort();
  const head = ['keyword', 'volume', 'yoy_pct', 'change3_pct', 'peak_month', 'seasonality', 'competition', 'competition_index', 'bid_low', 'bid_high', 'avg_cpc', ...months];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [head.join(',')];
  for (const r of rows) {
    const byMonth = Object.fromEntries((r.monthly || []).map((m) => [m.month, m.volume]));
    lines.push([r.keyword, r.noData ? '' : r.volume, r.yoy, r.change3, r.peak, r.seasonality, r.competition, r.competitionIndex, r.bidLow, r.bidHigh, r.avgCpc, ...months.map((m) => byMonth[m])].map(esc).join(','));
  }
  return lines.join('\n');
}
