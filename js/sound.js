// Sound for the time-lapse: each radar pass plays a note whose pitch follows
// the brightness at the chosen point, so a melt season or a flood pulse has
// a shape you can hear. The mapping is fixed: 0 to 255 on the preview scale
// spans two octaves upward from 220 Hz, and the cross-polarised channel is a
// second, softer voice one octave lower.

let audio = null;

function voice(frequency, gain, type, at) {
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.03);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
  osc.connect(amp).connect(audio.destination);
  osc.start(at);
  osc.stop(at + 0.75);
}

export const pitch = (value) => 220 * 2 ** ((value / 255) * 2);

// point: { co, cross } with null where a pass has no data there.
export function playPass(point) {
  if (!point || point.co == null) return;
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  const now = audio.currentTime;
  voice(pitch(point.co), 0.16, 'triangle', now);
  if (point.cross != null) voice(pitch(point.cross) / 2, 0.09, 'sine', now);
}
