const test = require('node:test');
const assert = require('node:assert');
const { jpegInfo } = require('../src/jpeg-info.js');

const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const table = (q) => { const s = q < 50 ? 5000 / q : 200 - 2 * q; return STD_LUMA.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100)))); };
const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];

function fakeJpeg({ q, w, h, sampling = 0x22, comps = 3, wide = false, app1 = 0 }) {
  const dqt = wide ? [0x10, ...table(q).flatMap((v) => [0, v])] : [0x00, ...table(q)];
  const sof = [8, h >> 8, h & 255, w >> 8, w & 255, comps, 1, sampling, 0, ...(comps === 3 ? [2, 0x11, 1, 3, 0x11, 1] : [])];
  return Uint8Array.from([0xff, 0xd8, ...(app1 ? seg(0xe1, new Array(app1).fill(0xff)) : []), ...seg(0xdb, dqt), ...seg(0xc0, sof), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
}

test('reads size, IJG quality and chroma sampling', () => {
  for (const q of [30, 50, 72, 85, 90, 96]) assert.deepStrictEqual(jpegInfo(fakeJpeg({ q, w: 4000, h: 3000 })), { width: 4000, height: 3000, quality: q, sampling: '4:2:0' });
  assert.strictEqual(jpegInfo(fakeJpeg({ q: 80, w: 10, h: 10, sampling: 0x11 })).sampling, '4:4:4');
  assert.strictEqual(jpegInfo(fakeJpeg({ q: 80, w: 10, h: 10, sampling: 0x21 })).sampling, '4:2:2');
  assert.strictEqual(jpegInfo(fakeJpeg({ q: 80, w: 10, h: 10, comps: 1 })).sampling, 'gray');
});

test('handles 16-bit tables, metadata segments full of 0xFF and non-JPEG input', () => {
  assert.strictEqual(jpegInfo(fakeJpeg({ q: 75, w: 64, h: 48, wide: true })).quality, 75);
  assert.deepStrictEqual(jpegInfo(fakeJpeg({ q: 88, w: 1920, h: 2560, app1: 500 })), { width: 1920, height: 2560, quality: 88, sampling: '4:2:0' });
  assert.strictEqual(jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.strictEqual(jpegInfo(new Uint8Array(0)), null);
});
