const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../projects');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'projects-test-'));
const THUMB = `data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')}`;

test('photo project: create, list, load, rename keeps state and media', async () => {
  const root = tmpRoot();
  const photo = Buffer.from('photo-bytes');
  const state = { W: 1080, H: 1920, objects: [{ kind: 'text', sourceText: 'विठ्ठल', fontId: 'aaditya' }] };
  const { id } = await P.save(root, { name: 'Wari', kind: 'photo', state, thumb: THUMB, media: { bytes: photo, type: 'image/jpeg', name: 'wari.jpg' } });

  const [s] = await P.list(root);
  assert.strictEqual(s.id, id);
  assert.strictEqual(s.name, 'Wari');
  assert.strictEqual(s.kind, 'photo');
  assert.strictEqual(s.thumb, THUMB);

  await P.save(root, { id, name: '  Wari 2026  ' });
  const p = await P.load(root, id);
  assert.strictEqual(p.name, 'Wari 2026');
  assert.deepStrictEqual(p.state, state);
  assert.deepStrictEqual(Buffer.from(p.media.bytes), photo);
  assert.strictEqual(p.media.type, 'image/jpeg');
  assert.strictEqual(p.media.path, null);
  assert.strictEqual(p.missing, null);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, id)).sort(), ['media.jpg', 'project.json', 'thumb.jpg']);
});

test('replacing the photo removes the old media file', async () => {
  const root = tmpRoot();
  const { id } = await P.save(root, { kind: 'photo', media: { bytes: Buffer.from('a'), type: 'image/jpeg' } });
  await P.save(root, { id, media: { bytes: Buffer.from('b'), type: 'image/png' } });
  assert.deepStrictEqual(fs.readdirSync(path.join(root, id)).sort(), ['media.png', 'project.json']);
  assert.deepStrictEqual(Buffer.from((await P.load(root, id)).media.bytes), Buffer.from('b'));
});

test('video project references the file and reports it missing after deletion', async () => {
  const root = tmpRoot();
  const video = path.join(root, 'clip.mp4');
  fs.writeFileSync(video, 'video-bytes');
  const { id } = await P.save(root, { name: 'Clip', kind: 'video', state: { trim: [1, 3] }, media: { path: video, type: 'video/mp4', name: 'clip.mp4' } });
  assert.deepStrictEqual(fs.readdirSync(path.join(root, id)).sort(), ['project.json']);

  let p = await P.load(root, id);
  assert.strictEqual(p.media.path, video);
  assert.deepStrictEqual(Buffer.from(p.media.bytes), Buffer.from('video-bytes'));
  assert.strictEqual((await P.list(root))[0].mediaPath, video);

  fs.rmSync(video);
  p = await P.load(root, id);
  assert.strictEqual(p.media, null);
  assert.strictEqual(p.missing, video);
  assert.deepStrictEqual(p.state, { trim: [1, 3] });
});

test('list is newest first, skips broken projects, and leaves no temp files', async () => {
  const root = tmpRoot();
  const a = await P.save(root, { name: 'A' });
  const b = await P.save(root, { name: 'B' });
  await P.save(root, { id: a.id, state: { x: 1 } });
  fs.mkdirSync(path.join(root, '00000000-0000-0000-0000-000000000000'));
  fs.writeFileSync(path.join(root, '00000000-0000-0000-0000-000000000000', 'project.json'), '{broken');
  fs.mkdirSync(path.join(root, 'not-a-project'));
  assert.deepStrictEqual((await P.list(root)).map((s) => s.name), ['A', 'B']);
  for (const id of [a.id, b.id]) assert.ok(!fs.readdirSync(path.join(root, id)).some((f) => f.endsWith('.tmp')));
});

test('duplicate is an independent copy', async () => {
  const root = tmpRoot();
  const { id } = await P.save(root, { name: 'Diwali', kind: 'photo', state: { v: 1 }, thumb: THUMB, media: { bytes: Buffer.from('p'), type: 'image/png' } });
  const copy = await P.duplicate(root, id);
  assert.notStrictEqual(copy.id, id);
  assert.strictEqual(copy.name, 'Diwali copy');
  assert.strictEqual(copy.thumb, THUMB);
  await P.save(root, { id: copy.id, state: { v: 2 } });
  assert.deepStrictEqual((await P.load(root, id)).state, { v: 1 });
  assert.deepStrictEqual((await P.load(root, copy.id)).state, { v: 2 });
  assert.deepStrictEqual(Buffer.from((await P.load(root, copy.id)).media.bytes), Buffer.from('p'));
});

test('rejects path traversal ids and unknown ids', async () => {
  const root = tmpRoot();
  await assert.rejects(P.load(root, '../../etc'), /Bad project id/);
  await assert.rejects(P.save(root, { id: '../x', name: 'n' }), /Bad project id/);
  await assert.rejects(P.save(root, { id: '11111111-1111-1111-1111-111111111111', name: 'n' }), /Project not found/);
  assert.deepStrictEqual(fs.readdirSync(root), []);
  assert.throws(() => P.projectDir(root, 'x/../../y'), /Bad project id/);
});
