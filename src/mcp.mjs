import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { keywordIdeas, keywordMetrics, findLocations, resolveTargeting } from './planner.mjs';
import { table } from './format.mjs';
import { redact } from './http.mjs';

const { version } = createRequire(import.meta.url)('../package.json');
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const run = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return { content: [{ type: 'text', text: redact(e.message || String(e)) }], isError: true };
  }
};
const result = (rows, header) => ({
  content: [{ type: 'text', text: table(rows, { header }) }],
  structuredContent: { rows },
});

const where = {
  geo: z.string().optional().describe('Country code ("US"), place name ("Ohio"), or Google location id. Several separated by ";". Default US.'),
  language: z.string().optional().describe('Language code ("en", "es") or id. Default en.'),
};

export async function startServer() {
  const server = new McpServer({ name: 'keyword-planner', version });

  server.registerTool(
    'keyword_metrics',
    {
      title: 'Search volume for specific keywords',
      description:
        'Google Ads Keyword Planner numbers for keywords you name: average monthly searches, 24 months of history, true year-over-year and 3-month trend, peak month, competition and top-of-page bids. "no data" means too few searches to report, not zero. Use to size demand or compare candidate keywords.',
      inputSchema: { keywords: z.array(z.string()).min(1).max(1000), ...where },
      annotations: READ_ONLY,
    },
    run(async ({ keywords, geo, language }) => {
      const t = await resolveTargeting({ geo: geo || 'US', language: language || 'en' });
      return result(await keywordMetrics(keywords, t), `Keyword metrics (${geo || 'US'}, ${language || 'en'})`);
    }),
  );

  server.registerTool(
    'keyword_ideas',
    {
      title: 'Find related keywords',
      description:
        'Related keyword ideas from Keyword Planner, seeded by up to 20 keywords, a page URL, or a whole site, with volume, trend and competition. Sort by volume, growth (fastest-rising year over year) or competition (easiest first).',
      inputSchema: {
        seeds: z.array(z.string()).max(20).optional(),
        url: z.string().optional().describe('A page to pull ideas from'),
        site: z.string().optional().describe('A whole domain to pull ideas from'),
        limit: z.number().int().min(1).max(500).optional(),
        min_volume: z.number().int().min(0).optional(),
        sort: z.enum(['volume', 'growth', 'competition']).optional(),
        ...where,
      },
      annotations: READ_ONLY,
    },
    run(async ({ seeds = [], url, site, limit = 50, min_volume = 0, sort = 'volume', geo, language }) => {
      const t = await resolveTargeting({ geo: geo || 'US', language: language || 'en' });
      const rows = await keywordIdeas({ seeds, url, site, limit, minVolume: min_volume, sort, ...t });
      return result(rows, `Keyword ideas (${geo || 'US'}, ${language || 'en'}), sorted by ${sort}`);
    }),
  );

  server.registerTool(
    'find_location',
    {
      title: 'Find a Google location id',
      description: 'Resolve a place name to Google Ads location ids (country, state, city, metro) for targeting keyword research.',
      inputSchema: { query: z.string(), country: z.string().optional().describe('2-letter country code to narrow results') },
      annotations: READ_ONLY,
    },
    run(async ({ query, country }) => {
      const rows = await findLocations(query, { country });
      return {
        content: [{ type: 'text', text: rows.length ? rows.map((r) => `${r.id}  ${r.name}  (${r.type})`).join('\n') : 'no matches' }],
        structuredContent: { rows },
      };
    }),
  );

  await server.connect(new StdioServerTransport());
}
