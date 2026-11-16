const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/font-utils.js');

test('legacyOf supports ams, dg, infinity, explicit none override, and legacy boolean entries', () => {
  const impNone = { id: 'imported-a', legacy: null };
  const impAutoDg = { id: 'imported-b', legacy: 'dg' };

  assert.strictEqual(U.legacyOf(null, {}), null);
  assert.strictEqual(U.legacyOf(impNone, {}), null);
  assert.strictEqual(U.legacyOf(impNone, { 'imported-a': 'dg' }), 'dg');
  assert.strictEqual(U.legacyOf(impNone, { 'imported-a': 'infinity' }), 'infinity');
  assert.strictEqual(U.legacyOf(impNone, { 'imported-a': 'ams' }), 'ams');
  assert.strictEqual(U.legacyOf(impNone, { 'imported-a': true }), 'ams');
  assert.strictEqual(U.legacyOf(impAutoDg, {}), 'dg');
  assert.strictEqual(U.legacyOf(impAutoDg, { 'imported-b': 'none' }), null);
});

test('weightBounds parses variable weight descriptors and returns null for static fonts', () => {
  assert.deepStrictEqual(U.weightBounds({ weight: '100 900' }), [100, 900]);
  assert.deepStrictEqual(U.weightBounds({ weight: '300 700' }), [300, 700]);
  assert.strictEqual(U.weightBounds({ weight: null }), null);
  assert.strictEqual(U.weightBounds({}), null);
});

test('wrapTextLines accounts for letter spacing, outline width, and background box padding', () => {
  // Base char width = 30px; without spacing, "Story Editor Long Spaced" (24 chars) = 720px <= 972px (fits on 1 line).
  // With spacing=500 at fontSize=78, each gap adds 39px -> 24*30 + 23*39 = 1617px > 972px, so it MUST wrap!
  const measure = (x) => [...x].length * 30;
  const text = 'Story Editor Long Spaced Headline Wrap Check';

  const unspaced = U.wrapTextLines(text, { stageW: 1080, fontSize: 78, spacing: 0, measure });
  assert.strictEqual(unspaced.split('\n').length, 2);

  const spaced = U.wrapTextLines(text, { stageW: 1080, fontSize: 78, spacing: 500, strokeWidth: 10, measure });
  const lines = spaced.split('\n');
  assert.ok(lines.length >= 4, `expected >= 4 wrapped lines with spacing=500, got ${lines.length}: ${JSON.stringify(lines)}`);
  for (const line of lines) {
    const renderedW = measure(line) + Math.max(0, [...line].length - 1) * ((78 * 500) / 1000) + 10;
    assert.ok(renderedW <= 1080 * 0.9, `line "${line}" width ${renderedW} exceeds max ${1080 * 0.9}`);
  }

  // Unicode Devanagari ignores positive charSpacing (so spacing doesn't break shirorekha), matching restyle()
  const mr = U.wrapTextLines('नमस्कार महाराष्ट्र वारी', { stageW: 1080, fontSize: 60, spacing: 600, hasDevanagari: true, legacy: null, measure });
  assert.strictEqual(mr.split('\n').length, 1);
});

test('findFont resolves exact fontId and matches imported fonts for legacy short ids from saved projects', () => {
  const fonts = [
    { id: 'inter', label: 'Inter', source: 'bundled' },
    { id: 'imported-ams-aaditya', label: 'AMS Aaditya', source: 'imported' },
    { id: 'imported-dgcally-03', label: 'DGCally-03', source: 'imported' },
    { id: 'imported-infinity-12-1', label: 'Infinity-12', source: 'imported' },
  ];
  const map = new Map(fonts.map((f) => [f.id, f]));

  assert.strictEqual(U.findFont(map, fonts, 'inter')?.id, 'inter');
  assert.strictEqual(U.findFont(map, fonts, 'aaditya')?.id, 'imported-ams-aaditya');
  assert.strictEqual(U.findFont(map, fonts, 'dg-cally-03')?.id, 'imported-dgcally-03');
  assert.strictEqual(U.findFont(map, fonts, 'infinity-12')?.id, 'imported-infinity-12-1');
  assert.strictEqual(U.findFont(map, fonts, 'missing-xyz'), null);
});

