(function (root) {
  function legacyOf(f, legacyMap = {}) {
    if (!f) return null;
    const ov = legacyMap ? legacyMap[f.id] : undefined;
    if (ov === 'none' || ov === false) return null;
    if (ov === true) return 'ams';
    if (ov === 'ams' || ov === 'dg' || ov === 'infinity') return ov;
    return f.legacy || null;
  }

  function weightBounds(f) {
    const m = /^(\d+)\s+(\d+)$/.exec(String(f?.weight || '').trim());
    if (!m) return null;
    const min = +m[1], max = +m[2];
    return max > min ? [min, max] : null;
  }

  const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  function findFont(fontById, fonts, id) {
    if (!id) return null;
    if (fontById?.has(id)) return fontById.get(id);
    const target = compact(id);
    if (!target || !Array.isArray(fonts)) return null;
    return fonts.find((f) => {
      const base = String(f.label || '').replace(/^ams\s+/i, '');
      return [f.label, base, base.replace(/\s+1$/, ''), base.replace(/-[a-z]$/i, '')].some((x) => compact(x) === target);
    }) || null;
  }

  function wrapTextLines(s, opts = {}) {
    const { stageW, scaleX = 1, fontSize = 40, spacing = 0, strokeWidth = 0, bgMode = 'none', legacy = null, hasDevanagari = false, toDisplay, measure } = opts;
    if (!stageW || typeof measure !== 'function') return s;
    const sp = !legacy && hasDevanagari ? 0 : (spacing || 0);
    const extra = (fontSize * sp) / 1000;
    const pad = (strokeWidth || 0) + (bgMode && bgMode !== 'none' ? fontSize * 0.6 : 0);
    const max = Math.max(fontSize, (stageW * 0.9) / (scaleX || 1) - pad);
    const width = (x) => {
      const t = toDisplay ? toDisplay(x) : x;
      return measure(t) + Math.max(0, [...t].length - 1) * extra;
    };
    return String(s || '').split('\n').map((line) => {
      const out = [];
      let cur = '';
      for (const word of line.split(' ')) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && width(next) > max) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
      return out.join('\n');
    }).join('\n');
  }

  const api = { legacyOf, weightBounds, findFont, wrapTextLines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FontUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
