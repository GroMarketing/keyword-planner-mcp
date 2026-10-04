---
name: keyword-research
description: Size search demand with Google Ads Keyword Planner data - monthly volume, 24-month history, year-over-year and 3-month trend, seasonality, competition and bids - for keywords you name or ideas from seeds, a URL or a site. Use when choosing SEO/content topics, page titles, product names or ad keywords, or when someone asks "how many people search for X" or "is X growing".
---

# keyword-research

Use the `keyword-planner` MCP tools if connected, otherwise the CLI
(`npx keyword-planner-mcp ...`).

| Need | Tool / command |
|---|---|
| Numbers for keywords you already have | `keyword_metrics` / `keyword-planner metrics "a" "b"` |
| New keywords around a topic, page or site | `keyword_ideas` / `keyword-planner ideas "seed" [--url] [--site]` |
| Rising topics | `keyword_ideas` with `sort: growth` and a `min_volume` floor |
| Easier keywords | `keyword_ideas` with `sort: competition` |
| A place to target | `find_location` / `keyword-planner geo "Columbus, Ohio"` |

## Read the numbers honestly

- **Volumes are rounded buckets** (1,000 / 1,300 / 1,600 / 1,900 / 2,400 ...),
  and accounts with little ad spend may see wider ranges. Treat them as orders
  of magnitude: 1,900 vs 2,400 is the same demand.
- **"no data" is not zero.** It means too few searches for Google to report.
- **`competition` is advertiser competition** in Google Ads, not how hard the
  keyword is to rank for organically.
- **Trend:** `yoy` is the last 3 months against the same 3 a year earlier;
  `3mo` is the last 3 against the 3 before. A big `yoy` with a negative `3mo`
  means a spike that is cooling. Check the sparkline before calling something
  "growing".
- **Close variants are merged** ("video editor" and "video editors" share one
  number). Don't add them together.
- People search by product name plus tool more than by job: compare
  "notion mcp" with "mcp for notes" before assuming the job phrasing wins.

## Report

Lead with the answer (is there demand, is it rising), then a short table:
keyword, volume, yoy, 3mo, peak month. Name the geo and language used. Say
when a number is a bucket or "no data" rather than presenting it as precise.
