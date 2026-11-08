(function (root) {
  const STD_LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
  ];
  const scaledSum = (q) => {
    const s = q < 50 ? 5000 / q : 200 - 2 * q;
    return STD_LUMA.reduce((a, v) => a + Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))), 0);
  };

  function jpegInfo(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    const info = { width: 0, height: 0, quality: null, sampling: null };
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      const seg = i + 4;
      if (m === 0xdb) {
        for (let p = seg; p < i + 2 + len;) {
          const pq = b[p] >> 4, tq = b[p] & 15, n = 64 * (pq ? 2 : 1);
          if (tq === 0 && info.quality == null) {
            let sum = 0;
            for (let k = 0; k < 64; k++) sum += pq ? (b[p + 1 + 2 * k] << 8) | b[p + 2 + 2 * k] : b[p + 1 + k];
            let best = 1;
            for (let q = 1; q <= 100; q++) if (Math.abs(scaledSum(q) - sum) < Math.abs(scaledSum(best) - sum)) best = q;
            info.quality = best;
          }
          p += 1 + n;
        }
      } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        info.height = (b[seg + 1] << 8) | b[seg + 2];
        info.width = (b[seg + 3] << 8) | b[seg + 4];
        const h = b[seg + 7] >> 4, v = b[seg + 7] & 15;
        info.sampling = b[seg + 5] === 1 ? 'gray' : h === 2 && v === 2 ? '4:2:0' : h === 2 && v === 1 ? '4:2:2' : h === 1 && v === 1 ? '4:4:4' : `${h}x${v}`;
      } else if (m === 0xda) break;
      i += 2 + len;
    }
    return info;
  }

  const api = { jpegInfo };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JpegInfo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
