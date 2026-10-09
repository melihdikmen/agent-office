// Voice input: records the microphone as 16 kHz mono WAV and hands it to the main
// process (local whisper). Stops on the second click, on a pause after speech, or
// after two minutes. The text is typed into the terminal without pressing Enter.
const SPEECH = 0.02, PAUSE_MS = 1800, MAX_MS = 120000;

function wavOf(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

export class Voice {
  // hooks: { onState(state, info), transcribe(wavBytes) → text }
  constructor(hooks) { this.h = hooks; this.state = 'idle'; this.target = null; }

  async start(target) {
    if (this.state !== 'idle') return;
    this.target = target;
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { this.h.onState('error', { message: /denied|permission/i.test(e.message) ? 'Mikrofon izni verilmedi (Sistem Ayarları → Gizlilik → Mikrofon).' : `Mikrofon açılamadı: ${e.message}` }); return; }
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = []; this.heard = false; this.lastVoice = Date.now(); this.t0 = Date.now(); this.peak = 0;
    this.node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length);
      this.peak = Math.max(this.peak, rms);
      if (rms > SPEECH) { this.heard = true; this.lastVoice = Date.now(); }
      this.h.onState('recording', { level: Math.min(1, rms * 8), secs: (Date.now() - this.t0) / 1000, heard: this.heard });
      if ((this.heard && Date.now() - this.lastVoice > PAUSE_MS) || Date.now() - this.t0 > MAX_MS) this.stop();
    };
    src.connect(this.node); this.node.connect(this.ctx.destination);       // the node must be connected to run; its output stays silent
    this.state = 'recording';
    this.h.onState('recording', { level: 0, secs: 0, heard: false });
  }

  teardown() {
    try { this.node?.disconnect(); this.stream?.getTracks().forEach((t) => t.stop()); this.ctx?.close(); } catch { /* already closed */ }
    this.node = this.stream = this.ctx = null;
  }

  cancel() { if (this.state !== 'recording') return; this.teardown(); this.state = 'idle'; this.h.onState('idle'); }

  async stop() {
    if (this.state !== 'recording') return;
    this.state = 'processing';
    const chunks = this.chunks, target = this.target, heard = this.heard;
    this.teardown();
    if (!heard || !chunks.length) { this.state = 'idle'; this.h.onState('empty', { target }); return; }
    this.h.onState('processing', { target });
    try {
      const text = await this.h.transcribe(wavOf(chunks, 16000));
      this.state = 'idle';
      this.h.onState(text ? 'done' : 'empty', { text, target });
    } catch (e) { this.state = 'idle'; this.h.onState('error', { message: e.message }); }
  }
}

export { wavOf };
