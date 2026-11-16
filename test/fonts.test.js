const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../fonts');

const BUNDLED = path.join(__dirname, '..', 'fonts');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-test-'));

// Build a minimal valid OpenType sfnt binary with name and optional fvar tables so tests never depend on gitignored fonts
function makeFakeTtf({ family = 'TestFont', subfamily = 'Regular', manufacturer = '', copyright = '', weightRange = null } = {}) {
  const recs = [
    [0, copyright],
    [1, family],
    [2, subfamily],
    [4, subfamily === 'Regular' ? family : `${family} ${subfamily}`],
    [8, manufacturer],
  ].filter(([, v]) => v);
  const strBufs = recs.map(([, v]) => {
    const b = Buffer.alloc(v.length * 2);
    for (let i = 0; i < v.length; i++) b.writeUInt16BE(v.charCodeAt(i), i * 2);
    return b;
  });
  const nameHdr = Buffer.alloc(6 + recs.length * 12);
  nameHdr.writeUInt16BE(0, 0);
  nameHdr.writeUInt16BE(recs.length, 2);
  nameHdr.writeUInt16BE(nameHdr.length, 4);
  let off = 0;
  recs.forEach(([nid], i) => {
    const r = 6 + i * 12;
    nameHdr.writeUInt16BE(3, r);
    nameHdr.writeUInt16BE(1, r + 2);
    nameHdr.writeUInt16BE(0x0409, r + 4);
    nameHdr.writeUInt16BE(nid, r + 6);
    nameHdr.writeUInt16BE(strBufs[i].length, r + 8);
    nameHdr.writeUInt16BE(off, r + 10);
    off += strBufs[i].length;
  });
  const tables = [['name', Buffer.concat([nameHdr, ...strBufs])]];
  if (weightRange) {
    const fvar = Buffer.alloc(16 + 20);
    fvar.writeUInt16BE(1, 0);
    fvar.writeUInt16BE(16, 4);
    fvar.writeUInt16BE(2, 6);
    fvar.writeUInt16BE(1, 8);
    fvar.writeUInt16BE(20, 10);
    fvar.write('wght', 16, 4, 'latin1');
    fvar.writeInt32BE(Math.round(weightRange[0] * 65536), 20);
    fvar.writeInt32BE(Math.round(400 * 65536), 24);
    fvar.writeInt32BE(Math.round(weightRange[1] * 65536), 28);
    tables.push(['fvar', fvar]);
  }
  const dir = Buffer.alloc(12 + tables.length * 16);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tables.length, 4);
  let tOff = dir.length;
  tables.forEach(([tag, buf], i) => {
    const e = 12 + i * 16;
    dir.write(tag, e, 4, 'latin1');
    dir.writeUInt32BE(tOff, e + 8);
    dir.writeUInt32BE(buf.length, e + 12);
    tOff += buf.length;
  });
  return Buffer.concat([dir, ...tables.map(([, b]) => b)]);
}

test('inspectFont reads OpenType names and variable weight range from real and synthetic font binaries', () => {
  const inter = F.inspectFont(fs.readFileSync(path.join(BUNDLED, 'google', 'Inter-Variable.ttf')));
  assert.strictEqual(inter.family, 'Inter');
  assert.deepStrictEqual(inter.weightRange, [100, 900]);

  const baloo = F.inspectFont(fs.readFileSync(path.join(BUNDLED, 'google', 'Baloo2-Variable.ttf')));
  assert.deepStrictEqual(baloo.weightRange, [400, 800]);

  const poppins = F.inspectFont(fs.readFileSync(path.join(BUNDLED, 'google', 'Poppins-Regular.ttf')));
  assert.strictEqual(poppins.family, 'Poppins');
  assert.strictEqual(poppins.weightRange, null);

  const dg = F.inspectFont(makeFakeTtf({ family: 'DGCally-24', manufacturer: 'DGTal Editz' }));
  assert.strictEqual(dg.family, 'DGCally-24');
  assert.match(dg.manufacturer, /DGTal Editz/i);
  assert.strictEqual(dg.weightRange, null);
});

test('importedMeta does not misclassify Kruti/Shree/Shivaji/Akruti as AMS and detects real OpenType metadata', () => {
  for (const name of ['KrutiDev010.ttf', 'ShreeDev0708.ttf', 'Shivaji01.ttf', 'AkrutiDevPriya.ttf']) {
    const m = F.importedMeta(name, Buffer.alloc(0));
    assert.strictEqual(m.legacy, null, `${name} should not default to ams`);
  }
  assert.strictEqual(F.importedMeta('AMS Custom.ttf', Buffer.alloc(0)).legacy, 'ams');
  assert.strictEqual(F.importedMeta('IndiaFontSample.ttf', Buffer.alloc(0)).legacy, 'ams');
  assert.strictEqual(F.importedMeta('DGSample.ttf', Buffer.alloc(0)).legacy, 'dg');
  assert.strictEqual(F.importedMeta('InfinitySample.ttf', Buffer.alloc(0)).legacy, 'infinity');

  const dgBytes = makeFakeTtf({ family: 'DGCally-24', manufacturer: 'DGTal Editz' });
  const customDg = F.importedMeta('CustomFont24.ttf', dgBytes);
  assert.strictEqual(customDg.legacy, 'dg');
  assert.strictEqual(customDg.style, 'calligraphy');
  assert.strictEqual(customDg.label, 'DGCally-24');

  const amsCalli = F.importedMeta('AMS Chandrakant.ttf', makeFakeTtf({ family: 'AMS Chandrakant', copyright: 'IndiaFont.com' }));
  assert.strictEqual(amsCalli.legacy, 'ams');
  assert.strictEqual(amsCalli.style, 'calligraphy');
});

test('copyFonts preserves distinct fonts with colliding filenames and skips identical duplicates', async () => {
  const root = tmpDir();
  const userDir = path.join(root, 'user-fonts');
  const emptyBundled = path.join(root, 'bundled');
  fs.mkdirSync(emptyBundled, { recursive: true });
  fs.writeFileSync(path.join(emptyBundled, 'manifest.json'), '[]');

  const dg03Bytes = makeFakeTtf({ family: 'DGCally-03', manufacturer: 'DGTal Editz' });
  const inf15Bytes = makeFakeTtf({ family: 'Infinity-15 Regular' });
  const pack = path.join(root, 'pack');
  fs.mkdirSync(path.join(pack, 'PackA'), { recursive: true });
  fs.mkdirSync(path.join(pack, 'PackB'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'PackA', 'Regular.ttf'), dg03Bytes);
  fs.writeFileSync(path.join(pack, 'PackB', 'Regular.ttf'), inf15Bytes);

  const imported = await F.copyFonts(emptyBundled, userDir, [pack]);
  assert.strictEqual(imported.length, 2);
  assert.deepStrictEqual(imported.map((f) => f.label).sort(), ['DGCally-03', 'Infinity-15']);
  assert.deepStrictEqual(imported.map((f) => f.legacy).sort(), ['dg', 'infinity']);
  const dgImp = imported.find((f) => f.label === 'DGCally-03');
  assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(userDir, dgImp.file.slice(9))), dg03Bytes), 0);

  // Re-importing the same folder is idempotent
  const again = await F.copyFonts(emptyBundled, userDir, [pack]);
  assert.strictEqual(again.length, 0);

  const all = await F.listFonts(emptyBundled, userDir);
  assert.strictEqual(all.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('listFonts auto-imports nested folders from customDir on startup and works cleanly when customDir is absent', async () => {
  const root = tmpDir();
  const userDir = path.join(root, 'user-fonts');
  const emptyBundled = path.join(root, 'bundled');
  const customDir = path.join(root, 'custom-fonts');
  fs.mkdirSync(emptyBundled, { recursive: true });
  fs.writeFileSync(path.join(emptyBundled, 'manifest.json'), '[]');
  fs.mkdirSync(path.join(customDir, 'ams'), { recursive: true });
  fs.mkdirSync(path.join(customDir, 'dg', 'sub'), { recursive: true });

  fs.writeFileSync(path.join(customDir, 'ams', 'AMS Aaditya.ttf'), makeFakeTtf({ family: 'AMS Aaditya', manufacturer: 'ArtoMania Studio' }));
  fs.writeFileSync(path.join(customDir, 'dg', 'sub', 'DGCally-03.ttf'), makeFakeTtf({ family: 'DGCally-03', manufacturer: 'DGTal Editz' }));

  const firstBoot = await F.listFonts(emptyBundled, userDir, customDir);
  assert.strictEqual(firstBoot.length, 2);
  assert.deepStrictEqual(firstBoot.map((f) => [f.label, f.legacy]).sort(), [['AMS Aaditya', 'ams'], ['DGCally-03', 'dg']]);

  // Second startup does not duplicate already-imported fonts
  const secondBoot = await F.listFonts(emptyBundled, userDir, customDir);
  assert.strictEqual(secondBoot.length, 2);

  // Open-source clone without custom-fonts folder works without error
  const ossBoot = await F.listFonts(emptyBundled, path.join(root, 'oss-user-fonts'), path.join(root, 'missing-custom-fonts'));
  assert.deepStrictEqual(ossBoot, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('listFonts enriches bundled variable fonts with weight ranges and removeFont safely deletes only imported fonts', async () => {
  const root = tmpDir();
  const userDir = path.join(root, 'user-fonts');
  const emptyBundled = path.join(root, 'bundled');
  fs.mkdirSync(emptyBundled, { recursive: true });
  fs.writeFileSync(path.join(emptyBundled, 'manifest.json'), '[]');

  const sample = path.join(root, 'MyScript.ttf');
  fs.copyFileSync(path.join(BUNDLED, 'google', 'GreatVibes-Regular.ttf'), sample);
  const [imp] = await F.copyFonts(emptyBundled, userDir, [sample]);
  assert.ok(imp.file.startsWith('imported/'));

  const bundledList = await F.listFonts(BUNDLED, userDir);
  const inter = bundledList.find((f) => f.id === 'inter');
  const poppins = bundledList.find((f) => f.id === 'poppins');
  assert.strictEqual(inter.weight, '100 900');
  assert.strictEqual(poppins.weight, null);

  await assert.rejects(() => F.removeFont(userDir, 'google/Inter-Variable.ttf'), /Bad font path/);
  await assert.rejects(() => F.removeFont(userDir, 'imported/../../etc/passwd'), /Bad font path/);

  await F.removeFont(userDir, imp.file);
  const after = (await F.listFonts(emptyBundled, userDir)).filter((f) => f.source === 'imported');
  assert.deepStrictEqual(after, []);
  fs.rmSync(root, { recursive: true, force: true });
});
