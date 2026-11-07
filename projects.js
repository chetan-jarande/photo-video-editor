const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/bmp': '.bmp' };

function projectDir(root, id) {
  if (!ID.test(String(id))) throw new Error('Bad project id');
  return path.join(root, id);
}

const readMeta = async (dir) => JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj));
  await fs.rename(tmp, file);
}

function summary(m, thumb) {
  return { id: m.id, name: m.name, kind: m.kind, createdAt: m.createdAt, updatedAt: m.updatedAt, thumb, mediaPath: m.mediaPath || null };
}

async function list(root) {
  const ids = (await fs.readdir(root).catch(() => [])).filter((n) => ID.test(n));
  const out = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    const m = await readMeta(dir).catch(() => null);
    if (!m) continue;
    const thumb = await fs.readFile(path.join(dir, 'thumb.jpg')).then((b) => `data:image/jpeg;base64,${b.toString('base64')}`, () => null);
    out.push(summary(m, thumb));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function save(root, p = {}) {
  const id = p.id || crypto.randomUUID();
  const dir = projectDir(root, id);
  const prev = await readMeta(dir).catch(() => null);
  if (p.id && !prev) throw new Error('Project not found');
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now();
  const m = {
    version: 1,
    id,
    name: String(p.name ?? prev?.name ?? 'Untitled story').trim().slice(0, 120) || 'Untitled story',
    kind: p.kind ?? prev?.kind ?? 'blank',
    createdAt: prev?.createdAt ?? now,
    updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1),
    mediaFile: prev?.mediaFile ?? null,
    mediaPath: prev?.mediaPath ?? null,
    mediaType: prev?.mediaType ?? null,
    mediaName: prev?.mediaName ?? null,
    state: p.state === undefined ? prev?.state ?? null : p.state,
  };
  if (p.media?.bytes) {
    const file = `media${EXT[p.media.type] || '.img'}`;
    await fs.writeFile(path.join(dir, file), Buffer.from(p.media.bytes));
    if (m.mediaFile && m.mediaFile !== file) await fs.rm(path.join(dir, m.mediaFile), { force: true });
    Object.assign(m, { mediaFile: file, mediaPath: null, mediaType: p.media.type || null, mediaName: p.media.name || null });
  } else if (p.media?.path) {
    if (m.mediaFile) await fs.rm(path.join(dir, m.mediaFile), { force: true });
    Object.assign(m, { mediaFile: null, mediaPath: path.resolve(p.media.path), mediaType: p.media.type || null, mediaName: p.media.name || null });
  }
  if (p.thumb) {
    const b64 = /^data:image\/(?:jpeg|png);base64,(.+)$/s.exec(p.thumb)?.[1];
    if (b64) await fs.writeFile(path.join(dir, 'thumb.jpg'), Buffer.from(b64, 'base64'));
  }
  await writeJsonAtomic(path.join(dir, 'project.json'), m);
  return { id, name: m.name, updatedAt: m.updatedAt };
}

async function load(root, id) {
  const dir = projectDir(root, id);
  const m = await readMeta(dir);
  let media = null;
  let missing = null;
  if (m.mediaFile) {
    media = { bytes: await fs.readFile(path.join(dir, m.mediaFile)), type: m.mediaType, name: m.mediaName, path: null };
  } else if (m.mediaPath) {
    const bytes = await fs.readFile(m.mediaPath).catch(() => null);
    if (bytes) media = { bytes, type: m.mediaType, name: m.mediaName, path: m.mediaPath };
    else missing = m.mediaPath;
  }
  return { id: m.id, name: m.name, kind: m.kind, state: m.state, media, missing };
}

async function duplicate(root, id) {
  const src = projectDir(root, id);
  const m = await readMeta(src);
  const copyId = crypto.randomUUID();
  const dst = projectDir(root, copyId);
  await fs.cp(src, dst, { recursive: true });
  const now = Date.now();
  Object.assign(m, { id: copyId, name: `${m.name} copy`.slice(0, 120), createdAt: now, updatedAt: now });
  await writeJsonAtomic(path.join(dst, 'project.json'), m);
  const thumb = await fs.readFile(path.join(dst, 'thumb.jpg')).then((b) => `data:image/jpeg;base64,${b.toString('base64')}`, () => null);
  return summary(m, thumb);
}

module.exports = { list, save, load, duplicate, projectDir };
