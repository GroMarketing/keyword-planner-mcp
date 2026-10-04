// Offline tests: every API response is synthetic. No credentials, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordMetrics, keywordIdeas, findLocations, resolveTargeting, trend, historyRange, sparkline, table, csv, redact } from '../src/index.mjs';

Object.assign(process.env, {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-dev-token-0000',
  GOOGLE_ADS_CLIENT_ID: 'test-client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'test-client-secret-0000',
  GOOGLE_ADS_REFRESH_TOKEN: 'test-refresh-token-0000',
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
});

const M = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
// Monthly history ending August 2026, oldest first, any length.
const history = (vals) => vals.map((v, i) => {
  const back = vals.length - 1 - i; // months before Aug 2026
  const idx = 7 - back;
  const year = 2026 + Math.floor(idx / 12);
  return { month: M[((idx % 12) + 12) % 12], year: String(year), monthlySearches: String(v) };
});
// 24 months: a flat 100 for the first year, then 100 for 9 months and 300 for the last 3.
const ROSE = [...Array(12).fill(100), ...Array(9).fill(100), 300, 300, 300];
const metric = (vals, extra = {}) => ({ avgMonthlySearches: String(Math.round(vals.reduce((a, b) => a + b) / vals.length)), monthlySearchVolumes: history(vals), competition: 'LOW', competitionIndex: '12', lowTopOfPageBidMicros: '1500000', highTopOfPageBidMicros: '6250000', ...extra });

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body && String(url).includes('googleads') ? JSON.parse(init.body) : null });
    if (String(url).includes('oauth2')) return res({ access_token: 'ya29.test' });
    return res(handler(String(url), calls.at(-1).body));
  };
  const res = (b) => ({ ok: !b?.__status, status: b?.__status || 200, url: '', text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) });
  fn.calls = calls;
  return fn;
}

test('trend: yoy is the last 3 months vs the same 3 months a year earlier; peak and seasonality use the last 12', () => {
  const vals = [50, 50, 50, ...Array(9).fill(100), 100, 100, 100, ...Array(6).fill(100), 100, 100, 100, 200, 200, 200];
  const months = vals.map((v, i) => ({ month: `m${i}`, volume: v }));
  const t = trend(months);
  // last 3 (200) vs months -15..-13 (100), not vs the oldest months (50)
  assert.equal(t.yoy, 100);
  assert.equal(t.change3, 100);
  assert.equal(t.peak, `m${vals.length - 3}`);
  assert.equal(t.seasonality, 1.6);
  assert.equal(trend(months.slice(-12)).yoy, null, 'no yoy without 15 months');
  assert.deepEqual(trend(months.slice(0, 3)), { change3: null, yoy: null, peak: null, seasonality: null });
});

test('historyRange asks for ~25 months ending last month', () => {
  assert.deepEqual(historyRange(new Date(Date.UTC(2026, 9, 4))), { start: { year: 2024, month: 'AUGUST' }, end: { year: 2026, month: 'SEPTEMBER' } });
  assert.deepEqual(historyRange(new Date(Date.UTC(2026, 0, 15))).end, { year: 2025, month: 'DECEMBER' });
});

test('calls are paced at least ~1.1s apart, even across separate requests', async () => {
  const times = [];
  const f = mockFetch(() => { times.push(Date.now()); return { results: [] }; });
  await Promise.all([keywordMetrics(['a'], { fetchImpl: f }), keywordMetrics(['b'], { fetchImpl: f })]);
  assert.ok(times[1] - times[0] >= 1050, `gap ${times[1] - times[0]}ms`);
});

test('metrics: exact keywords, close variants, and "no data" kept distinct from zero', async () => {
  const f = mockFetch((url, body) => {
    assert.match(url, /customers\/1234567890:generateKeywordHistoricalMetrics$/);
    assert.deepEqual(body.geoTargetConstants, ['geoTargetConstants/2840']);
    assert.ok(body.historicalMetricsOptions.yearMonthRange.start, 'asks for extended history');
    return { results: [
      { text: 'video editor', closeVariants: ['video editors'], keywordMetrics: metric(ROSE) },
      { text: 'zzqqxx', keywordMetrics: {} },
    ] };
  });
  const rows = await keywordMetrics(['video editors', 'zzqqxx', 'video editors'], { fetchImpl: f });
  assert.equal(rows.length, 2, 'duplicates removed');
  assert.equal(rows[0].keyword, 'video editors');
  assert.equal(rows[0].yoy, 200);
  assert.deepEqual(rows[0].closeVariants, ['video editors']);
  assert.equal(rows[0].bidLow, 1.5);
  assert.equal(rows[0].bidHigh, 6.25);
  assert.equal(rows[0].monthly.length, 24);
  assert.equal(rows[0].monthly[0].month, '2024-09');
  assert.equal(rows[0].monthly.at(-1).month, '2026-08');
  assert.equal(rows[1].noData, true);
  assert.equal(rows[1].volume, undefined);
});

test('ideas: filters by volume, sorts by growth, and pages until it has enough', async () => {
  let page = 0;
  const f = mockFetch((url, body) => {
    page++;
    assert.equal(body.includeAdultKeywords, false);
    if (page === 1) {
      assert.deepEqual(body.keywordSeed.keywords, ['crm']);
      return { nextPageToken: 'p2', results: [
        { text: 'crm', keywordIdeaMetrics: metric(Array(24).fill(1000)) },
        { text: 'tiny', keywordIdeaMetrics: metric(Array(24).fill(10)) },
      ] };
    }
    assert.equal(body.pageToken, 'p2');
    return { results: [{ text: 'ai crm', keywordIdeaMetrics: metric([...Array(21).fill(100), 500, 500, 500]) }] };
  });
  const rows = await keywordIdeas({ seeds: ['crm'], minVolume: 50, sort: 'growth', limit: 10, fetchImpl: f });
  assert.deepEqual(rows.map((r) => r.keyword), ['ai crm', 'crm']);
});

test('ideas: url and site seeds use the right seed type', async () => {
  const seen = [];
  const f = mockFetch((url, body) => { seen.push(Object.keys(body).find((k) => k.endsWith('Seed'))); return { results: [] }; });
  await keywordIdeas({ url: 'https://example.com/p', fetchImpl: f });
  await keywordIdeas({ site: 'example.com', fetchImpl: f });
  await keywordIdeas({ seeds: ['a'], url: 'https://example.com/p', fetchImpl: f });
  assert.deepEqual(seen, ['urlSeed', 'siteSeed', 'keywordAndUrlSeed']);
  await assert.rejects(keywordIdeas({ fetchImpl: f }), /seed keywords, a url or a site/);
});

test('locations and targeting: country codes map locally, names resolve through Google', async () => {
  const f = mockFetch((url) => {
    assert.match(url, /geoTargetConstants:suggest$/);
    return { geoTargetConstantSuggestions: [{ reach: '6000000', geoTargetConstant: { id: '21168', status: 'ENABLED', canonicalName: 'Ohio,United States', targetType: 'State', countryCode: 'US' } }] };
  });
  assert.deepEqual(await findLocations('Ohio', { fetchImpl: f }), [{ id: '21168', name: 'Ohio,United States', type: 'State', country: 'US', reach: 6000000 }]);
  const t = await resolveTargeting({ geo: 'GB;Ohio;2840', language: 'es', fetchImpl: f });
  assert.deepEqual(t, { geo: ['2826', '21168', '2840'], language: '1003' });
});

test('a retired API version gets a clear message instead of a bare 404', async () => {
  const f = mockFetch(() => ({ __status: 404 }));
  const realF = async (url, init) => (String(url).includes('oauth2')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'ya29.test' }) }
    : { ok: false, status: 404, text: async () => '<html><body>404. That’s an error.</body></html>' });
  await assert.rejects(keywordMetrics(['x'], { fetchImpl: realF }), /retires old versions; set GOOGLE_ADS_API_VERSION/);
  void f;
});

test('credentials go in headers; errors are redacted', async () => {
  const f = mockFetch(() => ({ results: [] }));
  await keywordMetrics(['x'], { fetchImpl: f });
  const call = f.calls.find((c) => c.url.includes('googleads'));
  assert.doesNotMatch(call.url, /token|test-dev/);
  assert.equal(call.init.headers['developer-token'], 'test-dev-token-0000');
  assert.doesNotMatch(redact(`failed with ${process.env.GOOGLE_ADS_REFRESH_TOKEN}`), /test-refresh-token/);
});

test('formatting: sparkline, table and csv', () => {
  assert.equal(sparkline([{ volume: 0 }, { volume: 7 }]), '▁█');
  const rows = [{ keyword: 'a', volume: 1200, yoy: 50, change3: -5, monthly: [{ month: '2026-01', volume: 1 }, { month: '2026-02', volume: 2 }], peak: '2026-02', competition: 'low', competitionIndex: 9, bidLow: 1, bidHigh: 2 }, { keyword: 'b', noData: true }];
  const t = table(rows);
  assert.match(t, /1,200 +\+50% +-5%/);
  assert.match(t, /b +no data/);
  assert.match(t, /not the same as zero/);
  const c = csv(rows).split('\n');
  assert.equal(c[0].split(',').at(-1), '2026-02');
  assert.match(c[1], /^a,1200,50,-5,2026-02/);
});
