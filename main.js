const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { buildFfmpegArgs, runFfmpeg } = require('./export');
const projects = require('./projects');
const fonts = require('./fonts');

const ROOT = __dirname;
const BUNDLED_FONTS = path.join(ROOT, 'fonts');
const CUSTOM_FONTS = process.env.CUSTOM_FONTS_DIR || path.join(ROOT, 'custom-fonts');
const userFonts = () => path.join(app.getPath('userData'), 'fonts');
const projectsRoot = () => path.join(app.getPath('userData'), 'projects');
const SMOKE = !!process.env.SMOKE;

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Story Editor',
    backgroundColor: '#0f1012',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(ROOT, 'src', 'index.html'));
  if (SMOKE) smoke(win);
}

function smoke(w) {
  w.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  w.webContents.on('preload-error', (_e, p, err) => console.log(`[preload-error] ${p} ${err}`));
  w.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, Number(process.env.SMOKE_WAIT || 3000)));
    if (process.env.SMOKE_JS) {
      try {
        console.log('[smoke-js]', JSON.stringify(await w.webContents.executeJavaScript(process.env.SMOKE_JS)));
      } catch (err) {
        console.log('[smoke-js-error]', err.message);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const img = await w.webContents.capturePage();
    const out = process.env.SMOKE_OUT || path.join(ROOT, 'out', 'smoke.png');
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, img.toPNG());
    console.log(`[smoke] screenshot ${out}`);
    app.quit();
  });
}

ipcMain.handle('fonts:list', () => fonts.listFonts(BUNDLED_FONTS, userFonts(), CUSTOM_FONTS));

ipcMain.handle('fonts:read', async (_e, file) => {
  const buf = await fs.readFile(fonts.resolveFont(BUNDLED_FONTS, userFonts(), file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('fonts:importFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import a font folder', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : fonts.copyFonts(BUNDLED_FONTS, userFonts(), r.filePaths);
});

ipcMain.handle('fonts:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import fonts',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  });
  return r.canceled ? [] : fonts.copyFonts(BUNDLED_FONTS, userFonts(), r.filePaths);
});

ipcMain.handle('fonts:importPaths', (_e, paths) => fonts.copyFonts(BUNDLED_FONTS, userFonts(), Array.isArray(paths) ? paths : []));
ipcMain.handle('fonts:remove', (_e, file) => fonts.removeFont(userFonts(), file));

ipcMain.handle('image:save', async (_e, dataUrl, defaultName) => {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Expected a PNG or JPEG data URL');
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('pictures'), defaultName || `story.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, Buffer.from(m[2], 'base64'));
  return r.filePath;
});

ipcMain.handle('projects:list', () => projects.list(projectsRoot()));
ipcMain.handle('projects:save', (_e, p) => projects.save(projectsRoot(), p));
ipcMain.handle('projects:load', (_e, id) => projects.load(projectsRoot(), id));
ipcMain.handle('projects:duplicate', (_e, id) => projects.duplicate(projectsRoot(), id));
ipcMain.handle('projects:delete', async (_e, id) => {
  const dir = projects.projectDir(projectsRoot(), id);
  try {
    await shell.trashItem(dir);
    return 'trash';
  } catch {
    const bin = path.join(app.getPath('userData'), 'deleted-projects');
    await fs.mkdir(bin, { recursive: true });
    await fs.rename(dir, path.join(bin, id));
    return 'deleted-projects';
  }
});

const writePng = (p, dataUrl) => fs.writeFile(p, Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));

ipcMain.handle('video:export', async (e, job) => {
  if (!job?.input && !job?.still) throw new Error('Nothing to export');
  const name = job.still ? 'story' : `${path.parse(job.input).name}-story`;
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('videos'), `${name}.mp4`),
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  });
  if (r.canceled || !r.filePath) return null;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'story-editor-'));
  try {
    const run = { ...job, overlays: [] };
    if (job.still) {
      run.input = path.join(tmp, 'background.png');
      await writePng(run.input, job.background);
    }
    for (const [i, o] of (job.overlays || []).entries()) {
      const { png, frames, ...rest } = o;
      if (frames?.length) {
        for (const [k, f] of frames.entries()) await writePng(path.join(tmp, `ov${i}-${String(k).padStart(4, '0')}.png`), f);
        run.overlays.push({ ...rest, pattern: path.join(tmp, `ov${i}-%04d.png`) });
      } else {
        const file = path.join(tmp, `ov${i}.png`);
        await writePng(file, png);
        run.overlays.push({ ...rest, file });
      }
    }
    const { args, dur } = buildFfmpegArgs(run, r.filePath);
    await runFfmpeg(args, dur, (f) => e.sender.send('video:progress', f));
    return r.filePath;
  } finally {
    fs.rm(tmp, { recursive: true, force: true });
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
