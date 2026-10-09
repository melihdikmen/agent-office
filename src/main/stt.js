'use strict';
// Speech to text with a local whisper.cpp: the renderer records 16 kHz mono WAV, this
// runs `whisper-cli` on it. Nothing leaves the machine. `setup()` installs the
// formula with Homebrew and downloads the model once, on the owner's click.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { findBin } = require('./engines');

const MODEL = { file: 'ggml-small-q5_1.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin', minBytes: 150 * 1024 * 1024 };
const BINS = ['whisper-cli', 'whisper-cpp'];

class Stt {
  // env: { dataDir, envPath, store }
  constructor(env) { this.env = env; this.busy = false; }

  get modelPath() { return process.env.AO_STT_MODEL || this.env.store.data.sttModel || path.join(this.env.dataDir, 'models', MODEL.file); }
  bin() {
    const set = process.env.AO_STT_BIN || this.env.store.data.sttBin;
    if (set && fs.existsSync(set)) return set;
    for (const b of BINS) { const p = findBin(b, this.env.envPath); if (p) return p; }
    return null;
  }
  modelOk() { try { return fs.statSync(this.modelPath).size >= (process.env.AO_STT_MODEL || this.env.store.data.sttModel ? 1 : (this.env.minBytes ?? MODEL.minBytes)); } catch { return false; } }
  status() {
    const bin = this.bin(), model = this.modelOk();
    return { bin, model, ready: !!bin && model, brew: !!findBin('brew', this.env.envPath), modelName: MODEL.file, busy: this.busy };
  }

  run(cmd, args, onLine) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { env: { ...process.env, PATH: this.env.envPath, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' } });
      let tail = '';
      const feed = (d) => { const t = d.toString(); tail = (tail + t).slice(-800); onLine?.(t); };
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} çıkış kodu ${code}: ${tail.trim().split('\n').pop()}`))));
    });
  }

  // brew install + model download; progress(text, pct?) is shown in the setup dialog.
  async setup(progress, fetchFn = globalThis.fetch) {
    if (this.busy) throw new Error('Kurulum zaten sürüyor.');
    this.busy = true;
    try {
      if (!this.bin()) {
        const brew = findBin('brew', this.env.envPath);
        if (!brew) throw new Error('Homebrew bulunamadı. https://brew.sh adresinden kur ya da whisper-cli yolunu elle ver.');
        progress('whisper-cpp kuruluyor (Homebrew)…');
        await this.run(brew, ['install', 'whisper-cpp'], (t) => { const l = t.trim().split('\n').pop(); if (l) progress(l.slice(0, 120)); });
        if (!this.bin()) throw new Error('whisper-cpp kuruldu ama whisper-cli bulunamadı.');
      }
      if (!this.modelOk()) {
        fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
        progress('Model indiriliyor…', 0);
        const res = await fetchFn(MODEL.url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`Model indirilemedi (${res.status}).`);
        const total = Number(res.headers.get('content-length')) || 0;
        const tmp = `${this.modelPath}.part`;
        const out = fs.createWriteStream(tmp);
        let got = 0, last = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
          if (Date.now() - last > 400) { last = Date.now(); progress(`Model indiriliyor… ${(got / 1048576).toFixed(0)} MB${total ? ` / ${(total / 1048576).toFixed(0)} MB` : ''}`, total ? got / total : undefined); }
        }
        await new Promise((r) => out.end(r));
        if (got < (this.env.minBytes ?? MODEL.minBytes)) { fs.rmSync(tmp, { force: true }); throw new Error('İndirilen model eksik; ağını kontrol edip tekrar dene.'); }
        fs.renameSync(tmp, this.modelPath);
      }
      progress('Hazır.', 1);
    } finally { this.busy = false; }
  }

  // wav: Buffer of a 16 kHz mono PCM WAV file. Resolves to the recognised text.
  transcribe(wav, { lang = 'tr' } = {}) {
    const st = this.status();
    if (!st.ready) return Promise.reject(new Error('Sesli komut kurulu değil.'));
    const file = path.join(os.tmpdir(), `ao-voice-${Date.now()}.wav`);
    fs.writeFileSync(file, wav);
    const args = ['-m', this.modelPath, '-f', file, '-l', lang, '-nt', '-np', '-t', String(Math.min(8, os.cpus().length))];
    return new Promise((resolve, reject) => {
      execFile(st.bin, args, { timeout: 90000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: this.env.envPath } }, (err, stdout, stderr) => {
        fs.rmSync(file, { force: true });
        if (err) return reject(new Error(`Çeviri başarısız: ${String(stderr || err.message).trim().split('\n').pop()}`));
        resolve(clean(stdout));
      });
    });
  }
}

// whisper prints "[BLANK_AUDIO]" / "(sessizlik)" style markers for silence; drop those.
function clean(out) {
  const t = String(out).replace(/\[[^\]]*\]|\([^)]*(müzik|sessiz|silence|blank|music)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

module.exports = { Stt, clean, MODEL };
