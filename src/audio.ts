let ctx: AudioContext | null = null;

export function startHum() {
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();

  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const hum = ctx.createOscillator();
  hum.type = "sawtooth";
  hum.frequency.value = 50;
  const humFilter = ctx.createBiquadFilter();
  humFilter.type = "lowpass";
  humFilter.frequency.value = 160;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.05;
  hum.connect(humFilter).connect(humGain).connect(master);
  hum.start();

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.2;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2400;
  band.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.035;
  noise.connect(band).connect(noiseGain).connect(master);
  noise.start();
}
