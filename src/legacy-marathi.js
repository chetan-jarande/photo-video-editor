(function (root) {
  // [full, half, round]. half null => full + halant 'x'. round => rakar is '^' instead of 'X'.
  const CONS = {
    'क': ['k', '|'], 'ख': ['Ka', 'K'], 'ग': ['ga', 'g'], 'घ': ['Ga', 'G'], 'ङ': ['D', null, 1],
    'च': ['ca', 'c'], 'छ': ['C', null, 1], 'ज': ['ja', 'j'], 'झ': ['Ja', 'J'], 'ञ': ['*a', '*'],
    'ट': ['o', null, 1], 'ठ': ['O', null, 1], 'ड': ['D', null, 1], 'ढ': ['Z', null, 1], 'ण': ['Na', 'N'],
    'त': ['ta', 't'], 'थ': ['Ta', 'T'], 'द': ['d', null, 1], 'ध': ['Ya', 'Y'], 'न': ['na', 'n'],
    'प': ['pa', 'p'], 'फ': ['f', null], 'ब': ['ba', 'b'], 'भ': ['Ba', 'B'], 'म': ['ma', 'm'],
    'य': ['ya', 'y'], 'र': ['r', null], 'ऱ': ['r', null], 'ल': ['la', 'l'], 'ळ': ['L', null], 'व': ['va', 'v'],
    'श': ['Sa', 'S'], 'ष': ['Va', 'V'], 'स': ['sa', 's'], 'ह': ['h', null, 1],
    'क्ष': ['Ha', 'H'], 'ज्ञ': ['za', 'z'], 'त्र': ['Pa', 'P'], 'श्र': ['Ma', 'M'],
  };
  const DG_CONJ = {
    'ट्ट': ['¡', null, 1], 'ड्ड': ['Ã', null, 1], 'ठ्ठ': ['þ', null, 1],
    'द्ध': ['Î', null, 1], 'द्र': ['É', null], 'ष्ट': ['Ñ', null, 1],
  };
  const MATRA = { 'ा': 'a', 'ु': 'u', 'ू': 'U', 'ृ': '&', 'े': 'e', 'ै': 'E', 'ो': 'ae', 'ौ': 'aE', 'ॅ': '`', 'ॉ': 'a`' };
  const MODS = { 'ं': '/', 'ँ': '~', 'ः': ':' };
  const VOWELS = { 'इ': 'q', 'ई': 'qQ', 'उ': 'w', 'ऊ': 'W', 'ऋ': 'R', 'ए': 'F', 'ऐ': 'Fe' };
  const V = {
    ams: { vow: { 'अ': 'A', 'आ': 'Aa', 'ओ': 'Aae', 'औ': 'AaE', 'ऑ': 'Aa`', 'ॐ': 'Aae~' }, i: 'i', iWide: '\\', ii: 'I', ruu: '#' },
    dg: { vow: { 'अ': 'Aa', 'आ': 'Aaa', 'ओ': 'Aaae', 'औ': 'AaaE', 'ऑ': 'Aaa`', 'ॐ': '_' }, i: 'ia', ii: 'aI', ruu: 'ÿ' },
    infinity: { vow: { 'अ': 'Aa', 'आ': 'Aaa', 'ओ': 'Aaae', 'औ': 'AaaE', 'ऑ': 'Aaa', 'ॐ': 'Aaae~' }, i: 'ia', ii: 'aI', ruu: 'rU' },
  };
  const HALANT = '्';
  const isCons = (c) => c in CONS && c.length === 1;

  function hasDevanagari(text) {
    return /[ऀ-ॿ]/.test(text || '');
  }

  function toLegacy(text, variant) {
    const vk = V[variant] ? variant : 'ams';
    const v = V[vk];
    const conj = vk === 'ams' ? CONS : Object.assign({}, CONS, { 'क': ['|a', '|'] }, vk === 'dg' ? DG_CONJ : {});
    const s = String(text || '').normalize('NFC').replace(/[‌‍़]/g, '');
    let out = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      const code = ch.charCodeAt(0);
      if (code >= 0x966 && code <= 0x96F) { out += String(code - 0x966); i++; continue; }
      if (ch === '।' || ch === '॥') {
        if (out && !/\s$/.test(out)) out += ' ';
        out += ch === '।' ? 'a' : 'aa';
        i++; continue;
      }
      if (v.vow[ch] || VOWELS[ch]) {
        out += v.vow[ch] || VOWELS[ch];
        i++;
        while (MODS[s[i]]) out += MODS[s[i++]];
        continue;
      }
      if (!isCons(ch)) { out += MATRA[ch] || MODS[ch] || ch; i++; continue; }

      // collect cluster: C (् C)*, trailing ् kept
      const cs = [ch];
      i++;
      let deadEnd = false;
      while (s[i] === HALANT) {
        if (isCons(s[i + 1])) { cs.push(s[i + 1]); i += 2; } else { deadEnd = true; i++; break; }
      }
      let reph = false;
      if (cs[0] === 'र' && cs.length > 1) { reph = true; cs.shift(); }
      // group into units, longest table match first, rakar folded into the unit before it
      const units = [];
      for (let k = 0; k < cs.length;) {
        const three = cs.slice(k, k + 3).join(HALANT);
        const two = cs.slice(k, k + 2).join(HALANT);
        const key = cs.length - k >= 3 && conj[three] ? three : cs.length - k >= 2 && conj[two] ? two : cs[k];
        k += key.split(HALANT).length;
        const u = { g: conj[key], rakar: false };
        if (cs[k] === 'र') { u.rakar = true; k++; }
        units.push(u);
      }
      const matra = MATRA[s[i]] !== undefined || s[i] === 'ि' || s[i] === 'ी' ? s[i++] : '';
      let body = '';
      units.forEach((u, n) => {
        const last = n === units.length - 1;
        const [full, half, round] = u.g;
        if (u.rakar) body += full + (round ? '^' : 'X') + (last && !deadEnd ? '' : 'x');
        else if (last) body += deadEnd ? full + 'x' : full;
        else body += half || full + 'x';
      });
      if (matra === 'ु' && cs.length === 1 && cs[0] === 'र' && !reph) body = '@';
      else if (matra === 'ू' && cs.length === 1 && cs[0] === 'र' && !reph) body = v.ruu;
      else if (matra === 'ि') body = (v.iWide && units.length > 1 ? v.iWide : v.i) + body;
      else if (matra === 'ी') body += v.ii;
      else if (matra) body += MATRA[matra];
      if (reph) body += 'Q';
      while (MODS[s[i]]) body += MODS[s[i++]];
      out += body;
    }
    return out;
  }

  const api = { toLegacy, hasDevanagari };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegacyMarathi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
