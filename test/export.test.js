const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildFfmpegArgs, runFfmpeg } = require('../export');

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const pixel = (file, t, x, y) =>
  [...execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

test('export trims, overlays text PNG in its time window, keeps audio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  const input = path.join(dir, 'in.mp4');
  const png = path.join(dir, 'ov.png');
  const out = path.join(dir, 'out.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=4', '-f', 'lavfi', '-i', 'sine=d=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
  ff(['-f', 'lavfi', '-i', 'color=c=red@1:s=320x240,format=rgba,geq=r=255:g=0:b=0:a=if(lt(X\\,160)\\,255\\,0)', '-frames:v', '1', png]);

  const job = { input, trimStart: 1, trimEnd: 3, muted: false, adjust: { brightness: 0.1, contrast: 0.2, saturation: 0.3 }, width: 320, height: 240, overlays: [{ file: png, start: 2, end: 3 }] };
  const { args, dur } = buildFfmpegArgs(job, out);
  let last = 0;
  await runFfmpeg(args, dur, (f) => (last = f));

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', out]));
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.15, `duration ${probe.format.duration}`);
  assert.deepStrictEqual(probe.streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  assert.strictEqual(last, 1);

  const before = pixel(out, 0.5, 40, 120);
  const during = pixel(out, 1.5, 40, 120);
  const outside = pixel(out, 1.5, 280, 120);
  assert.ok(before[0] < 80, `no overlay before window: ${before}`);
  assert.ok(during[0] > 180 && during[1] < 80, `red overlay inside window: ${during}`);
  assert.ok(outside[0] < 80, `transparent part stays clear: ${outside}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('muted export has no audio stream and odd sizes are made even', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  const input = path.join(dir, 'in.mp4');
  const out = path.join(dir, 'out.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc=s=321x241:r=30:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-c:v', 'libx264rgb', input]);
  const { args, dur } = buildFfmpegArgs({ input, trimStart: 0, trimEnd: 1, muted: true, adjust: { grayscale: true, hue: 20, sepia: true, blur: 0.2 }, width: 321, height: 241, overlays: [] }, out);
  await runFfmpeg(args, dur, () => {});
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', out]));
  assert.deepStrictEqual(probe.streams.map((s) => [s.codec_type, s.width, s.height]), [['video', 320, 240]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('photo becomes a video: animated frame sequence starts on time, holds last frame, music track added', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  const bg = path.join(dir, 'bg.png');
  const music = path.join(dir, 'music.m4a');
  const out = path.join(dir, 'out.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x240', '-frames:v', '1', bg]);
  ff(['-f', 'lavfi', '-i', 'sine=d=10', '-c:a', 'aac', music]);
  for (const [k, c] of ['red', 'lime', 'blue'].entries()) ff(['-f', 'lavfi', '-i', `color=c=${c}:s=320x240,format=rgba`, '-frames:v', '1', path.join(dir, `a-${String(k).padStart(4, '0')}.png`)]);

  const job = { still: true, input: bg, duration: 4, width: 320, height: 240, music: { path: music }, overlays: [{ pattern: path.join(dir, 'a-%04d.png'), fps: 2, start: 1, end: null }] };
  const { args, dur } = buildFfmpegArgs(job, out);
  await runFfmpeg(args, dur, () => {});

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', out]));
  assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.15, `duration ${probe.format.duration}`);
  assert.deepStrictEqual(probe.streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  const at = (t) => pixel(out, t, 100, 100).slice(0, 3);
  const [r0] = at(0.5);
  const [r1, g1] = at(1.2);
  const [, g2] = at(1.7);
  const [, , b3] = at(3.5);
  assert.ok(r0 < 60, `nothing before start ${at(0.5)}`);
  assert.ok(r1 > 180 && g1 < 80, `first frame red at 1.2s ${at(1.2)}`);
  assert.ok(g2 > 180, `second frame green at 1.7s ${at(1.7)}`);
  assert.ok(b3 > 180, `last frame held blue at 3.5s ${at(3.5)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
