const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const GENERIC_BASE = /^(?:regular|bold|italic|bolditalic|light|medium|semibold|extrabold|black|thin|variable|font|normal)$/i;
const utf16be = new TextDecoder('utf-16be');

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';
}

function inspectFont(bytes) {
  const empty = { family: '', subfamily: '', fullName: '', copyright: '', trademark: '', manufacturer: '', description: '', license: '', weightRange: null };
  if (!bytes || bytes.length < 12) return empty;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sig = b.readUInt32BE(0);
  if (sig !== 0x00010000 && sig !== 0x4f54544f && sig !== 0x74727565) return empty;

  const numTables = b.readUInt16BE(4);
  if (12 + numTables * 16 > b.length) return empty;
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = b.toString('latin1', off, off + 4);
    const toff = b.readUInt32BE(off + 8);
    const tlen = b.readUInt32BE(off + 12);
    if (toff + tlen <= b.length) tables[tag] = [toff, tlen];
  }

  const names = {};
  const rank = {};
  if (tables.name && tables.name[1] >= 6) {
    const [noff, nlen] = tables.name;
    const count = b.readUInt16BE(noff + 2);
    const strOff = b.readUInt16BE(noff + 4);
    const storage = noff + strOff;
    for (let i = 0; i < count && 6 + (i + 1) * 12 <= nlen; i++) {
      const r = noff + 6 + i * 12;
      const pid = b.readUInt16BE(r);
      const lid = b.readUInt16BE(r + 4);
      const nid = b.readUInt16BE(r + 6);
      const len = b.readUInt16BE(r + 8);
      const off = b.readUInt16BE(r + 10);
      if (storage + off + len > noff + nlen) continue;
      const raw = b.subarray(storage + off, storage + off + len);
      const txt = (pid === 0 || pid === 3 ? utf16be.decode(raw) : raw.toString('latin1'))
        .replace(/\0/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!txt) continue;
      const prio = pid === 3 && lid === 0x0409 ? 4 : pid === 3 ? 3 : pid === 0 ? 2 : 1;
      if (prio > (rank[nid] || 0)) {
        names[nid] = txt;
        rank[nid] = prio;
      }
    }
  }

  let weightRange = null;
  if (tables.fvar && tables.fvar[1] >= 16) {
    const [foff, flen] = tables.fvar;
    const axesOff = b.readUInt16BE(foff + 4);
    const axisCount = b.readUInt16BE(foff + 8);
    const axisSize = b.readUInt16BE(foff + 10);
    if (axisSize >= 20 && axesOff + axisCount * axisSize <= flen) {
      for (let a = 0; a < axisCount; a++) {
        const ao = foff + axesOff + a * axisSize;
        if (b.toString('latin1', ao, ao + 4) === 'wght') {
          const min = Math.round(b.readInt32BE(ao + 4) / 65536);
          const max = Math.round(b.readInt32BE(ao + 12) / 65536);
          if (max > min) weightRange = [min, max];
          break;
        }
      }
    }
  }

  return {
    copyright: names[0] || '',
    family: names[1] || '',
    subfamily: names[2] || '',
    fullName: names[4] || '',
    trademark: names[7] || '',
    manufacturer: names[8] || '',
    description: names[10] || '',
    license: names[13] || '',
    weightRange,
  };
}

function BufferReadSafe(b) {
  return Buffer.from(b);
}

function cleanLabel(info, base) {
  const fam = (info.family || '').replace(/\s+Regular$/i, '').trim();
  if (!fam) return base;
  const sub = (info.subfamily || '').trim();
  if (sub && !/^regular$/i.test(sub) && !fam.toLowerCase().includes(sub.toLowerCase())) return `${fam} ${sub}`;
  return fam;
}

function detectLegacy(base, info) {
  const meta = `${info.family} ${info.fullName} ${info.trademark} ${info.manufacturer} ${info.copyright}`;
  if (/^dg/i.test(base) || /\bdgt?(?:al\s*editz|fonts?|hand|cally)\b/i.test(meta)) return 'dg';
  if (/^infinity/i.test(base) || /\binfinity[-\s]*\d/i.test(meta)) return 'infinity';
  if (/^(?:ams(?![a-z])|indiafont)/i.test(base) || /\b(?:artomania|indiafont)\b|^ams(?![a-z])/i.test(meta.trim())) return 'ams';
  return null;
}

function detectStyle(base, info) {
  const s = `${base} ${info.family} ${info.subfamily} ${info.fullName} ${info.description} ${info.copyright}`;
  if (/callig|cally|hastkala|lekhan|chandrakant|sudha|indiafont|\bhand\b|dghand/i.test(s)) return 'calligraphy';
  if (/handwrit/i.test(s)) return 'handwriting';
  if (/\bscript\b|\bbrush\b/i.test(s)) return 'script';
  if (/\bmono\b|\bcourier\b|\bcode\b/i.test(s)) return 'mono';
  if (/\bserif\b/i.test(s) && !/\bsans\b/i.test(s)) return 'serif';
  if (/\bsans\b/i.test(s)) return 'sans';
  return 'display';
}

function importedMeta(file, bytes) {
  const name = path.basename(file);
  const base = name.replace(FONT_EXT, '');
  const info = bytes?.length ? inspectFont(BufferReadSafe(bytes)) : inspectFont(null);
  const legacy = detectLegacy(base, info);
  const idSlug = slug(base);
  return {
    id: `imported-${idSlug}`,
    family: `U ${idSlug.replace(/-/g, ' ')}`,
    label: cleanLabel(info, base),
    file: `imported/${name}`,
    lang: legacy ? ['mr'] : ['en'],
    style: detectStyle(base, info),
    legacy,
    weight: info.weightRange ? `${info.weightRange[0]} ${info.weightRange[1]}` : null,
    source: 'imported',
  };
}

function resolveFont(bundledDir, userDir, file) {
  const s = String(file || '');
  const [root, rel] = s.startsWith('imported/') ? [path.resolve(userDir), s.slice(9)] : [path.resolve(bundledDir), s];
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) || !FONT_EXT.test(full)) throw new Error(`Bad font path: ${file}`);
  return full;
}

async function listFonts(bundledDir, userDir, customDir) {
  if (customDir) await copyFonts(bundledDir, userDir, [customDir]);
  let bundled = [];
  try {
    bundled = JSON.parse(await fs.readFile(path.join(bundledDir, 'manifest.json'), 'utf8'));
  } catch (err) {
    console.error('fonts/manifest.json unreadable:', err.message);
  }
  const enrichedBundled = await Promise.all(
    bundled.map(async (f) => {
      const bytes = await fs.readFile(path.join(bundledDir, f.file)).catch(() => null);
      const info = bytes ? inspectFont(bytes) : null;
      return {
        ...f,
        weight: info?.weightRange ? `${info.weightRange[0]} ${info.weightRange[1]}` : null,
        source: 'bundled',
      };
    }),
  );
  const userFiles = (await fs.readdir(userDir).catch(() => [])).filter((f) => FONT_EXT.test(f)).sort();
  const imported = await Promise.all(
    userFiles.map(async (f) => {
      const bytes = await fs.readFile(path.join(userDir, f)).catch(() => null);
      return importedMeta(f, bytes);
    }),
  );
  return [...enrichedBundled, ...imported];
}

async function expandFontPaths(paths) {
  const out = [];
  for (const p of paths) {
    const st = await fs.stat(p).catch(() => null);
    if (st?.isDirectory()) {
      const entries = await fs.readdir(p, { recursive: true, withFileTypes: true });
      for (const d of entries) if (d.isFile() && FONT_EXT.test(d.name)) out.push(path.join(d.parentPath, d.name));
    } else if (st?.isFile() && FONT_EXT.test(p)) out.push(p);
  }
  return out;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function copyFonts(bundledDir, userDir, paths) {
  await fs.mkdir(userDir, { recursive: true });
  const seenHashes = new Set();
  const usedNames = new Set();

  const manifest = await fs.readFile(path.join(bundledDir, 'manifest.json'), 'utf8').then(JSON.parse, () => []);
  for (const f of manifest) {
    const b = await fs.readFile(path.join(bundledDir, f.file)).catch(() => null);
    if (b) seenHashes.add(sha1(b));
  }
  for (const f of (await fs.readdir(userDir).catch(() => [])).filter((n) => FONT_EXT.test(n))) {
    usedNames.add(f.toLowerCase());
    const b = await fs.readFile(path.join(userDir, f)).catch(() => null);
    if (b) seenHashes.add(sha1(b));
  }

  const added = [];
  for (const p of await expandFontPaths(paths)) {
    const bytes = await fs.readFile(p).catch(() => null);
    if (!bytes?.length) continue;
    const h = sha1(bytes);
    if (seenHashes.has(h)) continue;
    seenHashes.add(h);

    const ext = path.extname(p).toLowerCase();
    const rawBase = path.basename(p, path.extname(p));
    const info = inspectFont(bytes);
    const preferred = GENERIC_BASE.test(rawBase) ? cleanLabel(info, `${path.basename(path.dirname(p))}-${rawBase}`) : rawBase;
    const cleanBase = preferred.replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'font';
    let target = `${cleanBase}${ext}`;
    let n = 2;
    while (usedNames.has(target.toLowerCase())) target = `${cleanBase}-${n++}${ext}`;
    usedNames.add(target.toLowerCase());

    await fs.writeFile(path.join(userDir, target), bytes);
    added.push(importedMeta(target, bytes));
  }
  return added;
}

async function removeFont(userDir, file) {
  if (!String(file || '').startsWith('imported/')) throw new Error(`Bad font path: ${file}`);
  const full = resolveFont(userDir, userDir, file);
  await fs.rm(full, { force: true });
  return true;
}

module.exports = { FONT_EXT, inspectFont, importedMeta, resolveFont, listFonts, copyFonts, removeFont };
