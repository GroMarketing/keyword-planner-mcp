#!/usr/bin/env node
// Prints the README's sample table from made-up numbers (no API call, no account data).
//   node examples/sample-table.mjs
import { table } from '../src/format.mjs';

const months = (vals) => vals.map((volume, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, volume }));
const rows = [
  { keyword: 'cold brew concentrate recipe', volume: 6600, yoy: 212, change3: 48, monthly: months([2, 2, 3, 4, 6, 8, 9, 9, 7, 5, 6, 8].map((x) => x * 600)), peak: '2025-08', competition: 'low', competitionIndex: 14, bidLow: 0.42, bidHigh: 1.85 },
  { keyword: 'pour over coffee kettle', volume: 9900, yoy: 64, change3: 12, monthly: months([6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 11, 14].map((x) => x * 800)), peak: '2025-12', competition: 'high', competitionIndex: 88, bidLow: 0.61, bidHigh: 2.4 },
  { keyword: 'coffee grinder burr vs blade', volume: 2900, yoy: 31, change3: -6, monthly: months([3, 3, 3, 3, 3, 3, 3, 4, 4, 3, 3, 3].map((x) => x * 900)), peak: '2025-08', competition: 'medium', competitionIndex: 52, bidLow: 0.38, bidHigh: 1.6 },
  { keyword: 'french press ratio', volume: 4400, yoy: -18, change3: -22, monthly: months([6, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3].map((x) => x * 1000)), peak: '2025-01', competition: 'low', competitionIndex: 9, bidLow: 0.22, bidHigh: 0.95 },
  { keyword: 'aeropress inverted method', volume: null, noData: true },
];
console.log(table(rows, { header: 'Keyword ideas (US, en), sorted by growth' }));
