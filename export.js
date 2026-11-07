const { spawn } = require('child_process');

function contrastFactor(c) {
  const v = c * 255;
  return (259 * (v + 255)) / (255 * (259 - v));
}

function adjustFilters(a = {}, w, h) {
  const f = [];
  const b = a.brightness || 0;
  const c = a.contrast || 0;
  const s = a.saturation || 0;
  if (b || c || s) f.push(`eq=brightness=${b.toFixed(3)}:contrast=${contrastFactor(c).toFixed(3)}:saturation=${Math.max(0, 1 + s).toFixed(3)}`);
  if (a.hue) f.push(`hue=h=${Number(a.hue).toFixed(1)}`);
  if (a.grayscale) f.push('hue=s=0');
  if (a.sepia) f.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
  if (a.blur > 0) f.push(`gblur=sigma=${(a.blur * Math.max(w, h) * 0.07).toFixed(2)}`);
  return f;
}

function buildFfmpegArgs(job, out) {
  const still = !!job.still;
  const start = still ? 0 : Math.max(0, Number(job.trimStart) || 0);
  const dur = Math.max(0.1, still ? Number(job.duration) || 5 : Number(job.trimEnd) - start);
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  if (still) args.push('-loop', '1', '-framerate', '30', '-t', String(dur), '-i', job.input);
  else args.push('-ss', String(start), '-t', String(dur), '-i', job.input);

  const overlays = job.overlays || [];
  for (const o of overlays) {
    if (o.pattern) {
      if (o.loop) args.push('-stream_loop', '-1');
      args.push('-framerate', String(o.fps || 30), '-i', o.pattern);
    } else args.push('-i', o.file);
  }
  const musicIdx = overlays.length + 1;
  if (job.music?.path) args.push('-ss', String(Math.max(0, Number(job.music.offset) || 0)), '-i', job.music.path);

  const chain = [];
  const adj = still ? [] : adjustFilters(job.adjust, job.width, job.height);
  let last = '0:v';
  if (adj.length) {
    chain.push(`[${last}]${adj.join(',')}[a0]`);
    last = 'a0';
  }
  overlays.forEach((o, i) => {
    const s = o.start == null ? 0 : Math.max(0, o.start - start);
    const e = o.end == null ? dur + 1 : Math.max(0, o.end - start);
    let src = `${i + 1}:v`;
    if (o.pattern && s > 0) {
      chain.push(`[${src}]setpts=PTS-STARTPTS+${s.toFixed(3)}/TB[s${i}]`);
      src = `s${i}`;
    }
    const enable = o.start == null && o.end == null ? '' : `:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`;
    chain.push(`[${last}][${src}]overlay=0:0:format=auto${enable}[o${i}]`);
    last = `o${i}`;
  });
  chain.push(`[${last}]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]`);

  args.push('-filter_complex', chain.join(';'), '-map', '[vout]');
  if (job.music?.path) args.push('-map', `${musicIdx}:a`, '-c:a', 'aac', '-b:a', '192k');
  else if (job.muted || still) args.push('-an');
  else args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '192k');
  args.push('-t', String(dur), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', out);
  return { args, dur };
}

function runFfmpeg(args, dur, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(d.toString());
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / dur));
    });
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)));
    p.on('error', (x) => reject(new Error(x.code === 'ENOENT' ? 'ffmpeg is not installed. Install it with: sudo apt install ffmpeg' : x.message)));
    p.on('close', (code) => {
      if (code === 0) {
        onProgress(1);
        resolve();
      } else reject(new Error(`ffmpeg failed (code ${code}): ${err.trim().split('\n').slice(-4).join(' ')}`));
    });
  });
}

module.exports = { buildFfmpegArgs, runFfmpeg };
