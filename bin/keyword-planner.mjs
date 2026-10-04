#!/usr/bin/env node
import fs from 'node:fs';
import { keywordIdeas, keywordMetrics, findLocations, resolveTargeting } from '../src/planner.mjs';
import { table, csv } from '../src/format.mjs';
import { redact } from '../src/http.mjs';

const HELP = `keyword-planner: Google Ads Keyword Planner from the terminal or an AI agent.
Search volume, 24 months of history, trend, seasonality, competition and bids. Read-only.

  keyword-planner metrics <keyword>... [--file keywords.txt]
      Exact numbers for the keywords you name (up to 1,000).

  keyword-planner ideas <seed>... [--url <page>] [--site <domain>] [--limit 100] [--min-volume 0]
                        [--sort volume|growth|competition]
      Related keywords from up to 20 seeds, a page, or a whole site.

  keyword-planner geo <place> [--country US]
      Find Google's location id for a place ("Ohio", "Columbus, Ohio").

  keyword-planner mcp
      Run as an MCP server (stdio) for Claude Code, Cursor and others.

Common options:
  --geo US            country code, place name or location id; several with ";" ("Ohio;Texas")
  --lang en           language code or id
  --json | --csv      machine output instead of the table

Credentials come from the environment (see README): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID [, GOOGLE_ADS_LOGIN_CUSTOMER_ID]`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const VALUED = new Set(['geo', 'lang', 'url', 'site', 'limit', 'min-volume', 'sort', 'file', 'country']);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--') && VALUED.has(a.slice(2))) opt[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) opt[a.slice(2)] = true;
  else pos.push(a);
}

const emit = (rows, header) => {
  if (opt.json) console.log(JSON.stringify(rows, null, 2));
  else if (opt.csv) console.log(csv(rows));
  else console.log(table(rows, { header }));
};

async function main() {
  if (cmd === 'mcp') return (await import('../src/mcp.mjs')).startServer();
  if (cmd === 'geo' && pos.length) {
    const rows = await findLocations(pos.join(' '), { country: opt.country });
    if (opt.json) return console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return console.log('no matches');
    for (const r of rows) console.log(`${r.id.padStart(8)}  ${r.name}  (${r.type}${r.reach ? `, reach ${r.reach.toLocaleString('en-US')}` : ''})`);
    return;
  }
  if (cmd !== 'metrics' && cmd !== 'ideas') {
    console.log(HELP);
    process.exit(cmd && !['-h', '--help', 'help'].includes(cmd) ? 2 : 0);
  }
  const t = await resolveTargeting({ geo: opt.geo || 'US', language: opt.lang || 'en' });
  const where = `${opt.geo || 'US'}, ${opt.lang || 'en'}`;
  if (cmd === 'metrics') {
    const kws = [...pos, ...(opt.file ? fs.readFileSync(opt.file, 'utf8').split(/\r?\n/) : [])].filter((k) => k.trim());
    if (!kws.length) { console.error('give keywords, or --file with one per line'); process.exit(2); }
    emit(await keywordMetrics(kws, t), `Keyword metrics (${where})`);
  } else {
    if (!pos.length && !opt.url && !opt.site) { console.error('give seed keywords, --url or --site'); process.exit(2); }
    const rows = await keywordIdeas({ seeds: pos, url: opt.url, site: opt.site, limit: Number(opt.limit || 100), minVolume: Number(opt['min-volume'] || 0), sort: opt.sort || 'volume', ...t });
    emit(rows, `Keyword ideas (${where}), sorted by ${opt.sort || 'volume'}`);
  }
}

main().catch((e) => {
  console.error(redact(e.message || e));
  process.exit(1);
});
