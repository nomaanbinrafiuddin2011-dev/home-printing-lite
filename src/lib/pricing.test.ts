import { calculatePrice, DEFAULT_RATES } from './pricing.ts';
import assert from 'node:assert/strict';
const r = (x: any) => calculatePrice(x, DEFAULT_RATES) as any;
assert.equal(r({ totalPages: 10, range: '', copies: 1, mode: 'bw', sides: 1 }).totalPaise, 2000);
assert.equal(r({ totalPages: 10, range: '1-3,5', copies: 2, mode: 'c', sides: 1 }).totalPaise, 4 * 2 * 900);
const d = r({ totalPages: 5, range: '', copies: 2, mode: 'bw', sides: 2 });
assert.equal(d.totalPaise, 5 * 2 * 200); assert.equal(d.sheets, 6); // no double-sided discount
assert.equal(r({ totalPages: 5, range: '1-9', copies: 1, mode: 'bw', sides: 1 }).ok, false);
assert.equal(r({ totalPages: 5, range: '', copies: 0, mode: 'bw', sides: 1 }).ok, false);
assert.equal(r({ totalPages: 5, range: '2,2,2', copies: 1, mode: 'bw', sides: 1 }).totalPaise, 200);
console.log('pricing tests passed');
import { expandRange } from './pricing.ts';
assert.deepEqual((expandRange('1-3, 5, 8-10', 10) as any).pages, [1, 2, 3, 5, 8, 9, 10]);
assert.deepEqual((expandRange('3,1,2-3', 5) as any).pages, [1, 2, 3]);
for (const bad of ['0', '3-1', 'a', '1--2', '1-99999', '11']) assert.ok('error' in (expandRange(bad, 10) as any), bad);
assert.equal(r({ totalPages: 5, range: ',,', copies: 1, mode: 'bw', sides: 1 }).ok, false);
console.log('range tests passed');
