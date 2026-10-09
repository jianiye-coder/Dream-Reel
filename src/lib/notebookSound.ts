"use client";

/* Paper sounds for the notebook.
   - Pencil strokes are real recordings (public/sounds, CC0 — see CREDITS.md), sliced into grains.
   - Eraser, tap and page turn are synthesised with Web Audio.
   Browsers only allow audio after a user gesture, so nothing plays until unlock() runs. */

const PREF_KEY = "dr-sound";
const PUNCT = /[，。、；：？！…—,.;:?!"'“”‘’（）()]/;
const CJK = /[㐀-鿿]/;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let roomSend: GainNode | null = null;
let noise: AudioBuffer | null = null;
let pencil: AudioBuffer | null = null;
let grains: [number, number][] = [];
let lastGrain = -1;
let pencilLoading = false;

const listeners = new Set<(on: boolean) => void>();

export function soundEnabled() {
  return typeof window !== "undefined" && localStorage.getItem(PREF_KEY) !== "off";
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
  listeners.forEach((fn) => fn(on));
  if (on) { unlock(); tap(); }
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function audio(): AudioContext | null {
  if (!soundEnabled()) return null;
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 3;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);

  // a small, soft room: a short decaying noise impulse
  const room = ctx.createConvolver();
  const rl = Math.floor(ctx.sampleRate * 0.38);
  const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c);
    for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2) * (i < 40 ? i / 40 : 1);
  }
  room.buffer = ir;
  roomSend = ctx.createGain();
  roomSend.gain.value = 0.16;
  roomSend.connect(room).connect(comp);

  // 3 s of pink-ish noise, shared by every synthesised sound
  const len = ctx.sampleRate * 3;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  void loadPencil();
  return ctx;
}

async function loadPencil() {
  if (pencil || pencilLoading || !ctx) return;
  pencilLoading = true;
  try {
    const [buf, offsets] = await Promise.all([
      fetch("/sounds/pencil-sprite.mp3").then((r) => r.arrayBuffer()),
      fetch("/sounds/pencil-grains.json").then((r) => r.json() as Promise<[number, number][]>),
    ]);
    pencil = await ctx.decodeAudioData(buf);
    grains = offsets;
  } catch {
    // synthesised strokes stand in
  } finally {
    pencilLoading = false;
  }
}

/** Call from any user gesture; safe to call repeatedly. */
export function unlock() {
  audio();
}

function noiseSource() {
  const s = ctx!.createBufferSource();
  s.buffer = noise;
  return s;
}

function out(node: AudioNode) {
  node.connect(master!);
  node.connect(roomSend!);
}

// one recorded stroke, slightly re-pitched and re-levelled so no two sound alike
function grain(when: number, strength: number, maxDur: number) {
  let i: number;
  do { i = Math.floor(Math.random() * grains.length); } while (i === lastGrain && grains.length > 1);
  lastGrain = i;
  const [start, len] = grains[i];
  const dur = Math.min(len + 0.01, maxDur);
  const t = ctx!.currentTime + when;
  const s = ctx!.createBufferSource();
  const g = ctx!.createGain();
  const lp = ctx!.createBiquadFilter();
  s.buffer = pencil;
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  lp.type = "lowpass";
  lp.frequency.value = 5200 + Math.random() * 1500;
  const peak = (0.55 + Math.random() * 0.3) * strength;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.setValueAtTime(peak, t + Math.max(0.01, dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(lp).connect(g);
  out(g);
  s.start(t, Math.max(0, start - 0.004), dur + 0.02);
  return dur / s.playbackRate.value;
}

function synthStroke(when: number, strength: number) {
  const t = ctx!.currentTime + when;
  const dur = 0.035 + Math.random() * 0.075;
  const s = noiseSource();
  const hp = ctx!.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;
  const bp = ctx!.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200 + Math.random() * 1400;
  bp.Q.value = 1;
  const g = ctx!.createGain();
  const peak = (0.06 + Math.random() * 0.05) * strength;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
  s.connect(hp).connect(bp).connect(g).connect(master!);
  s.start(t, Math.random() * 2.5, dur + 0.05);
}

/** A short pencil mark (annotations, ticks). */
export function stroke(strength = 1, when = 0) {
  if (!audio()) return;
  if (pencil) grain(when, strength * 0.8, 0.11 + Math.random() * 0.06);
  else synthStroke(when, strength);
}

/** The sound of writing one character; returns its duration in seconds. */
export function writeChar(ch: string, when = 0): number {
  if (!ch || /\s/.test(ch) || !audio()) return 0;
  const punct = PUNCT.test(ch);
  const cjk = CJK.test(ch);
  if (pencil) {
    if (punct) return grain(when, 0.45, 0.07);
    // one or two strokes of real graphite, slightly overlapping
    let d = grain(when, 1, cjk ? 0.24 : 0.14);
    if (cjk && Math.random() < 0.55) d = Math.max(d, 0.07 + grain(when + 0.07 + Math.random() * 0.05, 0.8, 0.16));
    return d;
  }
  const n = punct ? 1 : cjk ? 2 + Math.floor(Math.random() * 3) : 1;
  let t = when;
  for (let i = 0; i < n; i++) { synthStroke(t, punct ? 0.55 : 1); t += 0.03 + Math.random() * 0.045; }
  return t - when;
}

export function erase() {
  if (!audio()) return;
  const t = ctx!.currentTime;
  for (let i = 0; i < 2; i++) {
    const s = noiseSource(), bp = ctx!.createBiquadFilter(), g = ctx!.createGain();
    bp.type = "bandpass";
    bp.frequency.value = 650 + Math.random() * 350;
    bp.Q.value = 1.1;
    const st = t + i * 0.09;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.09, st + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
    s.connect(bp).connect(g).connect(master!);
    s.start(st, Math.random() * 2.5, 0.12);
  }
}

export function tap() {
  if (!audio()) return;
  const t = ctx!.currentTime, s = noiseSource(), lp = ctx!.createBiquadFilter(), g = ctx!.createGain();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  s.connect(lp).connect(g).connect(master!);
  s.start(t, Math.random(), 0.1);
}

/* Page turn, in layers: the fingertip catching the page · paper fibres crackling as it flexes ·
   air moving with the page's speed · a flutter in the sheet · the landing and a small bounce.
   It travels right to left, and every turn is a little different. `heavy` is a stiff cover. */
export function pageTurn({ dur = 0.85, heavy = false } = {}) {
  if (!audio()) return;
  const c = ctx!;
  const t0 = c.currentTime + 0.01;
  const vel = (p: number) => Math.pow(Math.sin(Math.PI * Math.min(Math.max(p, 0), 1)), 1.4);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  const bus = c.createGain();
  let tail: AudioNode = bus;
  if (c.createStereoPanner) {
    const pan = c.createStereoPanner();
    pan.pan.setValueAtTime(0.45, t0);
    pan.pan.linearRampToValueAtTime(-0.4, t0 + dur);
    bus.connect(pan);
    tail = pan;
  }
  out(tail);

  const burst = (when: number, len: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.002) => {
    const s = noiseSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    s.connect(f).connect(g).connect(bus);
    s.start(when, Math.random() * 2.6, len + 0.02);
  };

  burst(t0, 0.08, "bandpass", rnd(2600, 3400), 0.9, heavy ? 0.03 : 0.05, 0.01);
  burst(t0 + rnd(0.025, 0.045), 0.006, "highpass", 2200, 0.7, heavy ? 0.05 : 0.13);

  const N = 48;
  const gainCurve = new Float32Array(N), freqCurve = new Float32Array(N), flutCurve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = vel(i / (N - 1));
    gainCurve[i] = 0.0001 + v * (heavy ? 0.16 : 0.11);
    freqCurve[i] = (heavy ? 260 : 420) + v * (heavy ? 900 : 1500);
    flutCurve[i] = 0.0001 + v * (heavy ? 0.03 : 0.07) * (0.55 + 0.45 * Math.random());
  }
  {
    const s = noiseSource(), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = "lowpass";
    lp.Q.value = 0.6;
    lp.frequency.setValueCurveAtTime(freqCurve, t0, dur);
    g.gain.setValueCurveAtTime(gainCurve, t0, dur);
    s.connect(lp).connect(g).connect(bus);
    s.start(t0, Math.random() * 1.5, dur + 0.05);
  }
  {
    const s = noiseSource(), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = "bandpass";
    bp.frequency.value = rnd(950, 1350);
    bp.Q.value = 1.3;
    g.gain.setValueCurveAtTime(flutCurve, t0, dur);
    s.connect(bp).connect(g).connect(bus);
    s.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  const count = heavy ? 10 : Math.floor(rnd(46, 70));
  for (let k = 0; k < count; k++) {
    let p: number;
    do { p = Math.random(); } while (Math.random() > vel(p) * 0.9 + 0.1);
    const big = Math.random() < 0.1;
    burst(t0 + p * dur * 0.92, rnd(0.002, big ? 0.016 : 0.008), "bandpass", rnd(2400, 7500), rnd(1.4, 4),
      (big ? rnd(0.14, 0.24) : rnd(0.03, 0.12)) * (0.35 + 0.65 * vel(p)) * (heavy ? 0.6 : 1), 0.0008);
  }

  const tl = t0 + dur * 0.93;
  burst(tl, heavy ? 0.16 : 0.09, "lowpass", heavy ? 170 : 230, 0.8, heavy ? 0.6 : 0.34, 0.004);
  burst(tl + 0.015, 0.13, "bandpass", rnd(1500, 2100), 0.8, 0.045, 0.02);
  burst(tl + rnd(0.07, 0.1), 0.05, "lowpass", 480, 0.8, heavy ? 0.12 : 0.07, 0.003);
}
