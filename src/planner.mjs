import { ApiError, env, getJson } from './http.mjs';

const HINT =
  'Keyword Planner needs a Google Ads account: set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, ' +
  'GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_CUSTOMER_ID (plus GOOGLE_ADS_LOGIN_CUSTOMER_ID if you reach it through a manager account). See the README.';
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const COMPETITION = { UNSPECIFIED: null, UNKNOWN: null, LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const digits = (s) => String(s || '').replace(/\D/g, '');
const micros = (m) => (m == null ? null : Math.round(Number(m) / 1e4) / 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keyword Planner allows roughly one request per second per customer; stay under it. */
const MIN_GAP_MS = 1100;
/** Shared by every client in this process, so back-to-back and concurrent calls are paced too. */
let lastCall = 0;
let queue = Promise.resolve();
const paced = () => {
  const turn = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
};

/**
 * Planner returns 12 months unless asked for more. Asking for ~25 months ending last month
 * gives true year-over-year; Google returns up to its latest available month (it lags about
 * a month) without erroring on the newest one.
 */
export function historyRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 25, 1));
  const ym = (d) => ({ year: d.getUTCFullYear(), month: MONTHS[d.getUTCMonth()] });
  return { start: ym(start), end: ym(end) };
}

export function plannerClient({ fetchImpl } = {}) {
  const V = process.env.GOOGLE_ADS_API_VERSION || 'v25';
  const base = `https://googleads.googleapis.com/${V}`;
  let access;

  const token = async () => {
    if (access) return access;
    const j = await getJson('Google OAuth', 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      fetchImpl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('GOOGLE_ADS_CLIENT_ID', HINT),
        client_secret: env('GOOGLE_ADS_CLIENT_SECRET', HINT),
        refresh_token: env('GOOGLE_ADS_REFRESH_TOKEN', HINT),
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!j.access_token) throw new Error('Google OAuth returned no access token; check the client id/secret and refresh token.');
    return (access = j.access_token);
  };

  const post = async (path, body) => {
    await paced();
    const login = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
    const headers = {
      Authorization: `Bearer ${await token()}`,
      'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN', HINT),
      'Content-Type': 'application/json',
      ...(login ? { 'login-customer-id': login } : {}),
    };
    try {
      return await getJson('Google Ads', `${base}/${path}`, { method: 'POST', headers, body: JSON.stringify(body), fetchImpl });
    } catch (e) {
      // A retired API version answers with Google's generic 404 HTML page, which reads like "the API is off".
      if (e instanceof ApiError && e.status === 404 && /<html|non-JSON/i.test(e.message)) {
        throw new Error(`Google Ads API ${V} answered 404. Google retires old versions; set GOOGLE_ADS_API_VERSION to a current one (see developers.google.com/google-ads/api/docs/release-notes).`);
      }
      throw e;
    }
  };

  const customer = () => digits(env('GOOGLE_ADS_CUSTOMER_ID', HINT));
  return { post, customer };
}

/** Months oldest-first as { month: 'YYYY-MM', volume }. */
function monthly(list = []) {
  return list
    .map((m) => ({ month: `${m.year}-${String(MONTHS.indexOf(m.month) + 1).padStart(2, '0')}`, volume: Number(m.monthlySearches || 0) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Direction of demand from the monthly history (oldest first).
 * yoy: last 3 months vs the same 3 months a year earlier (needs 15 months).
 * change3: last 3 months vs the 3 before. peak and seasonality use the last 12 months:
 * peak is the busiest month, seasonality is busiest month / average month.
 */
export function trend(months) {
  const v = months.map((m) => m.volume);
  if (v.length < 6) return { change3: null, yoy: null, peak: null, seasonality: null };
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const last3 = avg(v.slice(-3));
  const year = v.slice(-12);
  const yearMonths = months.slice(-12);
  const mean = avg(year);
  const peakIdx = year.indexOf(Math.max(...year));
  return {
    change3: pct(last3, avg(v.slice(-6, -3))),
    yoy: v.length >= 15 ? pct(last3, avg(v.slice(-15, -12))) : null,
    peak: yearMonths[peakIdx]?.month || null,
    seasonality: mean ? Math.round((year[peakIdx] / mean) * 100) / 100 : null,
  };
}

/** One normalized row. `metrics` absent means Google has no data, which is not the same as zero. */
function row(text, m, extra = {}) {
  if (!m || m.avgMonthlySearches == null) return { keyword: text, noData: true, ...extra };
  const months = monthly(m.monthlySearchVolumes);
  return {
    keyword: text,
    volume: Number(m.avgMonthlySearches),
    competition: COMPETITION[m.competition] ?? null,
    competitionIndex: m.competitionIndex != null ? Number(m.competitionIndex) : null,
    bidLow: micros(m.lowTopOfPageBidMicros),
    bidHigh: micros(m.highTopOfPageBidMicros),
    avgCpc: micros(m.averageCpcMicros),
    ...trend(months),
    monthly: months,
    ...extra,
  };
}

const targeting = (geoIds, languageId) => ({
  geoTargetConstants: geoIds.map((g) => `geoTargetConstants/${g}`),
  language: `languageConstants/${languageId}`,
  keywordPlanNetwork: 'GOOGLE_SEARCH',
});

/**
 * Exact metrics for the keywords you name (close variants are merged by Google
 * and listed). Up to 1,000 per call here; Google allows 10,000.
 */
export async function keywordMetrics(keywords, { geo = ['2840'], language = '1000', ...opts } = {}) {
  const list = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  if (!list.length) throw new Error('give at least one keyword');
  if (list.length > 1000) throw new Error('up to 1,000 keywords per request');
  const api = plannerClient(opts);
  const j = await api.post(`customers/${api.customer()}:generateKeywordHistoricalMetrics`, {
    keywords: list,
    ...targeting(geo, language),
    historicalMetricsOptions: { includeAverageCpc: true, yearMonthRange: historyRange() },
  });
  const byText = new Map();
  for (const r of j.results || []) {
    byText.set(r.text.toLowerCase(), r);
    for (const cv of r.closeVariants || []) if (!byText.has(cv.toLowerCase())) byText.set(cv.toLowerCase(), r);
  }
  return list.map((k) => {
    const r = byText.get(k.toLowerCase());
    return row(k, r?.keywordMetrics, r?.closeVariants?.length ? { closeVariants: r.closeVariants } : {});
  });
}

/**
 * Related keyword ideas from seed keywords, a page URL, or a whole site.
 * sort: 'volume' (default) | 'growth' (yoy) | 'competition' (lowest first).
 */
export async function keywordIdeas({ seeds = [], url, site, geo = ['2840'], language = '1000', limit = 100, minVolume = 0, sort = 'volume', ...opts } = {}) {
  const kw = seeds.map((s) => s.trim()).filter(Boolean);
  if (!kw.length && !url && !site) throw new Error('give seed keywords, a url or a site');
  if (kw.length > 20) throw new Error('Keyword Planner takes up to 20 seed keywords');
  const seed = site ? { siteSeed: { site } } : kw.length && url ? { keywordAndUrlSeed: { keywords: kw, url } } : url ? { urlSeed: { url } } : { keywordSeed: { keywords: kw } };
  const api = plannerClient(opts);
  const want = Math.min(Math.max(1, limit), 2000);
  const rows = [];
  let pageToken;
  // Fetch enough to fill `want` after the volume filter, with a page cap so a filter can't loop forever.
  for (let page = 0; page < 10; page++) {
    const j = await api.post(`customers/${api.customer()}:generateKeywordIdeas`, {
      ...seed,
      ...targeting(geo, language),
      includeAdultKeywords: false,
      historicalMetricsOptions: { yearMonthRange: historyRange() },
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const r of j.results || []) rows.push(row(r.text, r.keywordIdeaMetrics));
    pageToken = j.nextPageToken;
    if (!pageToken || rows.filter((r) => !r.noData && r.volume >= minVolume).length >= want * 3) break;
  }
  const kept = rows.filter((r) => !r.noData && r.volume >= minVolume);
  const by = {
    volume: (a, b) => b.volume - a.volume,
    growth: (a, b) => (b.yoy ?? -Infinity) - (a.yoy ?? -Infinity) || b.volume - a.volume,
    competition: (a, b) => (a.competitionIndex ?? 101) - (b.competitionIndex ?? 101) || b.volume - a.volume,
  }[sort];
  if (!by) throw new Error(`sort must be volume, growth or competition`);
  return kept.sort(by).slice(0, want);
}

/** Resolve place names to Google geo target ids: "US", "Ohio", "Columbus, Ohio". */
export async function findLocations(query, { country, ...opts } = {}) {
  const api = plannerClient(opts);
  const j = await api.post('geoTargetConstants:suggest', { locale: 'en', ...(country ? { countryCode: country } : {}), locationNames: { names: [query] } });
  return (j.geoTargetConstantSuggestions || [])
    .filter((s) => s.geoTargetConstant?.status === 'ENABLED')
    .map((s) => ({ id: s.geoTargetConstant.id, name: s.geoTargetConstant.canonicalName, type: s.geoTargetConstant.targetType, country: s.geoTargetConstant.countryCode, reach: s.reach != null ? Number(s.reach) : null }));
}

const COMMON_LANGUAGES = { en: '1000', de: '1001', fr: '1002', es: '1003', it: '1004', ja: '1005', nl: '1010', ko: '1012', pt: '1014', zh_CN: '1017', zh_TW: '1018' };
const COUNTRY_IDS = { US: '2840', GB: '2826', UK: '2826', CA: '2124', AU: '2036', DE: '2276', FR: '2250', ES: '2724', IT: '2380', IN: '2356', BR: '2076', MX: '2484', JP: '2392', NL: '2528', IE: '2372', NZ: '2554' };

/**
 * Turn user-friendly geo and language into ids. Geo accepts ids ("2840"),
 * common country codes ("US"), or names resolved through Google ("Ohio").
 */
export async function resolveTargeting({ geo = 'US', language = 'en', ...opts } = {}) {
  const geos = [];
  for (const g of (Array.isArray(geo) ? geo : String(geo).split(';')).map((s) => String(s).trim()).filter(Boolean)) {
    if (/^\d+$/.test(g)) geos.push(g);
    else if (COUNTRY_IDS[g.toUpperCase()]) geos.push(COUNTRY_IDS[g.toUpperCase()]);
    else {
      const [best] = await findLocations(g, opts);
      if (!best) throw new Error(`no Google location matches "${g}"; try "keyword-planner geo ${g}"`);
      geos.push(best.id);
    }
  }
  let lang = String(language);
  if (!/^\d+$/.test(lang)) {
    lang = COMMON_LANGUAGES[lang] || COMMON_LANGUAGES[lang.toLowerCase()];
    if (!lang) {
      const api = plannerClient(opts);
      const j = await api.post(`customers/${api.customer()}/googleAds:search`, {
        query: `SELECT language_constant.id FROM language_constant WHERE language_constant.code = '${String(language).replace(/'/g, '')}'`,
      });
      lang = j.results?.[0]?.languageConstant?.id;
      if (!lang) throw new Error(`unknown language code "${language}"`);
    }
  }
  return { geo: geos, language: lang };
}
