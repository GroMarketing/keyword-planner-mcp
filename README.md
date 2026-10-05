# keyword-planner-mcp

<p align="center"><img src="https://raw.githubusercontent.com/GroMarketing/keyword-planner-mcp/main/.github/social-preview.png" alt="keyword-planner-mcp: Google Keyword Planner MCP server and CLI" width="100%"></p>

Google Keyword Planner for AI agents and the terminal: a free, open-source keyword
research tool built on Google's own data. Ask how many people
search for something, whether that demand is growing, when it peaks, and what
advertisers pay for it, and get the answer from Google's own numbers.

```
$ npx keyword-planner-mcp ideas "coffee brewing" --sort growth --limit 5

Keyword ideas (US, en), sorted by growth

keyword                       volume/mo    yoy   3mo  last 12 months     peak       comp  top-of-page bid
cold brew concentrate recipe      6,600  +212%  +48%    ▁▁▂▃▅▇██▆▄▅▇  2025-08     low 14      $0.42-$1.85
pour over coffee kettle           9,900   +64%  +12%    ▁▁▂▂▂▃▃▃▄▄▅█  2025-12    high 88      $0.61-$2.40
coffee grinder burr vs blade      2,900   +31%   -6%    ▁▁▁▁▁▁▁██▁▁▁  2025-08  medium 52      $0.38-$1.60
french press ratio                4,400   -18%  -22%    █▆▆▆▃▃▃▃▃▃▁▁  2025-01      low 9      $0.22-$0.95
aeropress inverted method       no data

1 keyword(s) have no data: Google has too few searches to report, which is not the same as zero.
```

*Illustrative output with made-up numbers (run `node examples/sample-table.mjs`); real runs return Google's figures for your query.*

Every keyword comes with 24 months of history, so year-over-year is real and you
can tell a topic that is growing from one that spiked once and is cooling. It runs as an MCP server
(Claude Code, Cursor, Claude Desktop and others) and as a CLI. It is
**read-only**: it never creates campaigns or spends money.

## Why this one

Keyword tools either charge a monthly subscription for numbers that start as
Google's, or hand an agent one average volume and no direction. This gives the
agent the full picture from the source:

- **24 months of history, plus trend and seasonality** for every keyword: true
  year-over-year, last 3 months, peak month, and a sparkline. (Planner returns
  12 months unless asked; this asks for 24, so year-over-year compares the same
  months a year apart.)
- **"No data" is kept separate from zero.** Too few searches to report is a
  different answer from nobody searching.
- **Exact-keyword lookups use Google's historical-metrics endpoint,** so the
  keyword you asked about is the one you get, with close variants listed.
  Related-ideas endpoints can quietly drop or merge it.
- **Ideas from seeds, a page URL, or a whole site,** sortable by volume,
  growth or lowest competition.
- **Places by name.** `--geo "Ohio;Texas"` resolves through Google, so you
  don't have to look up location ids.
- **A clear error when Google retires an API version.** A retired version
  answers with a bare 404 page that looks like "the API is down"; this tells
  you which setting to change.

## Setup

Keyword Planner is part of the Google Ads API, so you need:

1. A **Google Ads account**. It's free, and no campaign or spend is required.
2. A **developer token** with Basic or Standard access, from Google Ads API
   Center (Tools > Setup > API Center). Test-account tokens return no data.
3. An **OAuth client** (Google Cloud console, Desktop app) and a **refresh
   token** with the `https://www.googleapis.com/auth/adwords` scope.

Then set these in your environment. See [`.env.example`](.env.example).

| Variable | |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | from API Center |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` | your OAuth client |
| `GOOGLE_ADS_REFRESH_TOKEN` | for the account you research with |
| `GOOGLE_ADS_CUSTOMER_ID` | that account's id, e.g. `123-456-7890` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | only if you reach it through a manager account |

Credentials are read from the environment only. They are sent in request
headers, never URLs, and error messages are scrubbed of them before printing.
The API version defaults to `v25`; override it with `GOOGLE_ADS_API_VERSION`.

## MCP server

```bash
claude mcp add keyword-planner -- npx -y keyword-planner-mcp mcp     # Claude Code
```

For Cursor, Claude Desktop and others:

```json
{ "mcpServers": { "keyword-planner": { "command": "npx", "args": ["-y", "keyword-planner-mcp", "mcp"] } } }
```

| Tool | What it does |
|---|---|
| `keyword_metrics` | Volume, 24-month history, trend, competition and bids for up to 1,000 keywords you name |
| `keyword_ideas` | Related keywords from up to 20 seeds, a URL or a site; sort by volume, growth or competition |
| `find_location` | Place name to Google location id |

All three are annotated read-only. Each takes `geo` (country code, place name,
or id; several separated by `;`) and `language` (e.g. `en`, `es`).

## Claude Code plugin

```
/plugin marketplace add GroMarketing/keyword-planner-mcp
/plugin install keyword-planner@keyword-planner-mcp
```

It installs the MCP server and a `keyword-research` skill. The skill tells
Claude how to read the numbers honestly: volumes are rounded buckets,
competition means advertiser competition rather than SEO difficulty, and a big
year-over-year jump with a falling 3-month trend is a spike that's cooling.

## CLI

```bash
npx keyword-planner-mcp metrics "remotion" "video editor" --geo US
npx keyword-planner-mcp metrics --file keywords.txt --csv > volumes.csv
npx keyword-planner-mcp ideas "crm for nonprofits" --sort competition --limit 50
npx keyword-planner-mcp ideas --site example.com --min-volume 100 --json
npx keyword-planner-mcp ideas "pizza" --geo "Columbus, Ohio"
npx keyword-planner-mcp geo "Ohio"
```

Installed globally (`npm i -g keyword-planner-mcp`), the command is
`keyword-planner`. `--csv` puts each of the 24 months in its own column for spreadsheets.

## Reading the numbers

- **Volumes are rounded buckets** (1,000, 1,300, 1,600, 1,900, 2,400 and so on).
  Accounts with little ad spend may see wider ranges. 1,900 vs 2,400 is the
  same demand.
- **`yoy`** is the last 3 months against the same 3 months a year earlier.
  **`3mo`** is the last 3 months against the 3 before. **`peak`** is the
  busiest of the last 12 months. Google's newest data lags about a month, so
  "last 3 months" ends at its latest available month.
- **`comp`** is advertiser competition in Google Ads (low/medium/high plus a
  0-100 index). It is not organic ranking difficulty.
- **Bids** are Google's estimated top-of-page range, in your account's currency.
- **Close variants** ("video editor", "video editors") share one number.

## Library

```js
import { keywordMetrics, keywordIdeas, resolveTargeting } from 'keyword-planner-mcp';

const t = await resolveTargeting({ geo: 'US', language: 'en' });
const rows = await keywordMetrics(['remotion', 'video editor'], t);
```

## Limits

- Keyword Planner allows about one request per second per account. Requests
  from one process (CLI run or MCP server) share a single queue paced to stay
  under that; separate processes are not coordinated.
- Seed ideas take up to 20 seeds per request. Metrics take up to 1,000 keywords.
- Numbers are Google Search only (not YouTube, Bing or Amazon).

## License

MIT
