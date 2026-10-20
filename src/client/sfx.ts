/** Petits effets sonores synthétisés (aucun fichier audio à embarquer). */
let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'triangle', vol = 0.18): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  join: () => {
    tone(660, 0, 0.12, 'sine');
    tone(990, 0.08, 0.18, 'sine');
  },
  question: () => {
    tone(523, 0, 0.15);
    tone(784, 0.12, 0.25);
  },
  reveal: () => [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.09, 0.3)),
  tick: () => tone(1200, 0, 0.05, 'square', 0.05),
  fanfare: () =>
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.14, i === 5 ? 0.8 : 0.2, 'sawtooth', 0.1)),
};
