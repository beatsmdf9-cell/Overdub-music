/* Overdub — standalone PWA build (vanilla JS + Tone.js) */

const ACCENT = "#6fa8c9", REC = "#e2574c", GREEN = "#8bd450";
const TRACK_COLORS = ["#6fa8c9", "#8bd450", "#4ddbc4", "#c084fc", "#e2b34c", "#e2574c", "#7d95b3"];
const PATCHES = [
  { id: "piano", name: "Piano" }, { id: "epiano", name: "E.Piano" }, { id: "organ", name: "Organ" },
  { id: "bass", name: "Bass" }, { id: "lead", name: "Lead" }, { id: "pad", name: "Pad" }, { id: "strings", name: "Strings" },
];
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const midiToNote = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
let uid = 1;
const nextId = () => `id${uid++}`;

function makeInstrument(patch) {
  switch (patch) {
    case "piano": return new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.8 } });
    case "epiano": return new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 3, envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 1 } });
    case "organ": return new Tone.PolySynth(Tone.Synth, { oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.2 } });
    case "bass": return new Tone.MonoSynth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }, filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.4, baseFrequency: 150, octaves: 3 } });
    case "lead": return new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.3 } });
    case "pad": return new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.6, decay: 0.3, sustain: 0.7, release: 1.8 } });
    case "strings": return new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.4, decay: 0.2, sustain: 0.8, release: 1.2 } });
    default: return new Tone.PolySynth(Tone.Synth);
  }
}

const state = {
  ready: false,
  bpm: 100, bars: 4, isPlaying: false, metronomeOn: true, loopPos: 0,
  armedTrackId: null, masterVol: 0.85,
  tracks: [{ id: nextId(), name: "Piano", patch: "piano", notes: [], muted: false, solo: false, volume: 0.85 }],
  midiInputs: [], midiInputId: null, midiStatus: "Checking for a MIDI device…",
  newPatch: "piano", showAddTrack: false, isRendering: false, exportUrl: null,
  deferredInstallPrompt: null,
};

const audio = {
  master: null, reverb: null, clickHi: null, clickLo: null, monitorInst: null,
  instruments: {}, parts: {}, clickLoop: null,
};
const openNotes = {};
let loopSec = 0;

function loopBeats() { return state.bars * 4; }

function setupAudioGraph() {
  audio.master = new Tone.Gain(state.masterVol).toDestination();
  audio.reverb = new Tone.Reverb({ decay: 1.8, wet: 0.15 }).connect(audio.master);
  audio.clickHi = new Tone.MembraneSynth({ envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(audio.master);
  audio.clickLo = new Tone.MembraneSynth({ envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(audio.master);
  audio.monitorInst = makeInstrument("piano").connect(audio.reverb);
  Tone.Transport.bpm.value = state.bpm;
  syncInstruments();
  rebuildClick();
}

async function ensureAudio() {
  if (!state.ready) {
    await Tone.start();
    state.ready = true;
    document.getElementById("startOverlay")?.remove();
  }
}

function syncInstruments() {
  const ids = new Set(state.tracks.map((t) => t.id));
  Object.keys(audio.instruments).forEach((id) => {
    if (!ids.has(id)) { audio.instruments[id].node.dispose(); audio.instruments[id].gain.dispose(); delete audio.instruments[id]; }
  });
  state.tracks.forEach((t) => {
    if (!audio.instruments[t.id]) {
      const node = makeInstrument(t.patch);
      const gain = new Tone.Gain(t.volume);
      node.connect(gain); gain.connect(audio.reverb);
      audio.instruments[t.id] = { node, gain };
    }
  });
  applyMixLevels();
}

function applyMixLevels() {
  const anySolo = state.tracks.some((t) => t.solo);
  state.tracks.forEach((t) => {
    const inst = audio.instruments[t.id];
    if (!inst) return;
    const silent = t.muted || (anySolo && !t.solo);
    inst.gain.gain.rampTo(silent ? 0 : t.volume, 0.05);
  });
}

function rebuildParts() {
  Object.values(audio.parts).forEach((p) => p.dispose());
  audio.parts = {};
  loopSec = (60 / state.bpm) * loopBeats();
  state.tracks.forEach((t) => {
    if (t.notes.length === 0) return;
    const part = new Tone.Part((time, note) => {
      const inst = audio.instruments[t.id];
      if (!inst) return;
      inst.node.triggerAttackRelease(note.pitch, note.dur, time, note.velocity);
    }, t.notes.map((n) => [n.startBeat * (60 / state.bpm), n]));
    part.loop = true;
    part.loopEnd = loopSec;
    audio.parts[t.id] = part;
    if (state.isPlaying) part.start(0);
  });
}

function rebuildClick() {
  audio.clickLoop?.dispose();
  audio.clickLoop = new Tone.Sequence((time, beat) => {
    if (!state.metronomeOn) return;
    if (beat === 0) audio.clickHi.triggerAttackRelease("C5", "32n", time, 0.5);
    else if (beat % 4 === 0) audio.clickLo.triggerAttackRelease("C4", "32n", time, 0.35);
  }, Array.from({ length: loopBeats() }, (_, i) => i), "4n");
  if (state.isPlaying) audio.clickLoop.start(0);
}

// ---------- Recording ----------
function noteOn(midiNote, velocity = 0.9) {
  const pitch = midiToNote(midiNote);
  const armedId = state.armedTrackId;
  const inst = armedId ? audio.instruments[armedId] : null;
  (inst ? inst.node : audio.monitorInst).triggerAttack(pitch, Tone.now(), velocity);
  if (armedId && state.isPlaying) openNotes[midiNote] = { startSec: Tone.Transport.seconds, velocity };
}

function noteOff(midiNote) {
  const pitch = midiToNote(midiNote);
  const armedId = state.armedTrackId;
  const inst = armedId ? audio.instruments[armedId] : null;
  (inst ? inst.node : audio.monitorInst).triggerRelease(pitch, Tone.now());
  const open = openNotes[midiNote];
  if (open && armedId && state.isPlaying) {
    delete openNotes[midiNote];
    const lb = loopBeats();
    const ls = loopSec || (60 / state.bpm) * lb;
    const startBeat = ((open.startSec % ls) / ls) * lb;
    let durSec = Tone.Transport.seconds - open.startSec;
    if (durSec <= 0) durSec += ls;
    const durBeat = Math.max(0.1, (durSec / ls) * lb);
    const track = state.tracks.find((t) => t.id === armedId);
    track.notes.push({ pitch, startBeat, dur: `${durBeat.toFixed(3)}i`, durBeats: durBeat, velocity: open.velocity });
    rebuildParts();
    renderTracks();
  }
}

// ---------- Web MIDI ----------
function setupMidi() {
  if (!navigator.requestMIDIAccess) {
    state.midiStatus = "This browser doesn't support Web MIDI — use the on-screen keyboard, or open this app in Chrome/Edge.";
    renderMidiStatus();
    return;
  }
  navigator.requestMIDIAccess().then((access) => {
    const refresh = () => {
      state.midiInputs = Array.from(access.inputs.values());
      if (state.midiInputs.length > 0) {
        if (!state.midiInputId) state.midiInputId = state.midiInputs[0].id;
        const cur = state.midiInputs.find((i) => i.id === state.midiInputId) || state.midiInputs[0];
        state.midiStatus = `Connected: ${cur.name}`;
        bindMidiInput(cur);
      } else {
        state.midiStatus = "No MIDI device detected — plug in the PSR-E363 via USB and it should appear here.";
      }
      renderMidiStatus();
    };
    access.onstatechange = refresh;
    refresh();
  }).catch(() => {
    state.midiStatus = "MIDI permission was blocked — use the on-screen keyboard below.";
    renderMidiStatus();
  });
}

function bindMidiInput(input) {
  state.midiInputs.forEach((i) => (i.onmidimessage = null));
  input.onmidimessage = (e) => {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
  };
}

// ---------- Transport ----------
async function handlePlay() {
  await ensureAudio();
  Tone.Transport.position = 0;
  Tone.Transport.start();
  state.isPlaying = true;
  Object.values(audio.parts).forEach((p) => p.start(0));
  audio.clickLoop?.start(0);
  renderTransport();
  loopTick();
}
function handleStop() {
  Tone.Transport.stop();
  Tone.Transport.cancel(0);
  state.isPlaying = false;
  state.loopPos = 0;
  Object.keys(openNotes).forEach((k) => delete openNotes[k]);
  renderTransport();
}
function loopTick() {
  if (!state.isPlaying) return;
  const ls = loopSec || (60 / state.bpm) * loopBeats();
  state.loopPos = ls > 0 ? (Tone.Transport.seconds % ls) / ls : 0;
  const fill = document.getElementById("loopBarFill");
  if (fill) fill.style.width = `${state.loopPos * 100}%`;
  requestAnimationFrame(loopTick);
}

// ---------- Track actions ----------
function addTrack() {
  const meta = PATCHES.find((p) => p.id === state.newPatch);
  state.tracks.push({ id: nextId(), name: meta.name, patch: state.newPatch, notes: [], muted: false, solo: false, volume: 0.85 });
  state.showAddTrack = false;
  syncInstruments();
  rebuildParts();
  renderTracks();
}
function removeTrack(id) {
  state.tracks = state.tracks.filter((t) => t.id !== id);
  if (state.armedTrackId === id) state.armedTrackId = null;
  syncInstruments();
  rebuildParts();
  renderTracks();
}
function clearTrack(id) {
  const t = state.tracks.find((x) => x.id === id);
  t.notes = [];
  rebuildParts();
  renderTracks();
}
function toggleMute(id) { const t = state.tracks.find((x) => x.id === id); t.muted = !t.muted; applyMixLevels(); renderTracks(); }
function toggleSolo(id) { const t = state.tracks.find((x) => x.id === id); t.solo = !t.solo; applyMixLevels(); renderTracks(); }
function setVolume(id, v) { const t = state.tracks.find((x) => x.id === id); t.volume = v; applyMixLevels(); }
function toggleArm(id) { state.armedTrackId = state.armedTrackId === id ? null : id; renderTracks(); }

// ---------- Export ----------
function bufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels, sampleRate = audioBuffer.sampleRate, bitDepth = 16;
  const samples = audioBuffer.length;
  const dataLength = samples * numChannels * (bitDepth / 8);
  const arrBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrBuffer);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); ws(8, "WAVE"); ws(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true); view.setUint16(34, bitDepth, true);
  ws(36, "data"); view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < samples; i++) for (let ch = 0; ch < numChannels; ch++) {
    const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); offset += 2;
  }
  return new Blob([arrBuffer], { type: "audio/wav" });
}

async function handleExport() {
  await ensureAudio();
  state.isRendering = true;
  renderTopBar();
  const bpm = state.bpm, lb = loopBeats(), ls = (60 / bpm) * lb;
  const durationSec = ls * 2;
  const tracksSnapshot = state.tracks;

  const buffer = await Tone.Offline(() => {
    const m = new Tone.Gain(state.masterVol).toDestination();
    const rev = new Tone.Reverb({ decay: 1.8, wet: 0.15 }).connect(m);
    const anySolo = tracksSnapshot.some((t) => t.solo);
    tracksSnapshot.forEach((t) => {
      if (t.notes.length === 0) return;
      const silent = t.muted || (anySolo && !t.solo);
      if (silent) return;
      const node = makeInstrument(t.patch);
      const g = new Tone.Gain(t.volume);
      node.connect(g); g.connect(rev);
      const part = new Tone.Part((time, note) => node.triggerAttackRelease(note.pitch, note.dur, time, note.velocity),
        t.notes.map((n) => [n.startBeat * (60 / bpm), n]));
      part.loop = true; part.loopEnd = ls; part.start(0);
    });
    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start();
  }, durationSec);

  const blob = bufferToWav(buffer.get());
  state.exportUrl = URL.createObjectURL(blob);
  state.isRendering = false;
  renderTopBar();
  renderExportBar();
}

// ---------- Rendering ----------
const root = document.getElementById("root");

function render() {
  root.innerHTML = `
    <div class="topBar" id="topBar"></div>
    <div class="midiStatus" id="midiStatus"></div>
    <div id="exportBar"></div>
    <div class="body">
      <div class="tracksPanel">
        <div class="tracksHeader">
          <span>TRACKS</span>
          <button class="addBtn" id="addTrackBtn">+</button>
        </div>
        <div id="addForm"></div>
        <div class="trackList" id="trackList"></div>
        <div class="masterRow">
          <span style="font-size:11px;color:#8fa0ad;">MASTER</span>
          <input type="range" min="0" max="1" step="0.01" id="masterVol" value="${state.masterVol}" />
        </div>
      </div>
      <div class="main">
        <div class="hint" id="armHint"></div>
        <div class="virtualKeys" id="virtualKeys"></div>
        <div class="hint">No MIDI device handy? Play these with your mouse/finger to test the app.</div>
      </div>
    </div>
    <div class="startOverlay" id="startOverlay">
      <button class="startBtn" id="startBtn">▶ Click to enable audio</button>
    </div>
  `;

  document.getElementById("startBtn").onclick = ensureAudio;
  document.getElementById("addTrackBtn").onclick = () => { state.showAddTrack = !state.showAddTrack; renderAddForm(); };
  document.getElementById("masterVol").oninput = (e) => { state.masterVol = Number(e.target.value); audio.master?.gain.rampTo(state.masterVol, 0.05); };

  renderTopBar();
  renderMidiStatus();
  renderExportBar();
  renderAddForm();
  renderTracks();
  renderVirtualKeys();
}

function renderTopBar() {
  const el = document.getElementById("topBar");
  el.innerHTML = `
    <div class="brand">🎛 OVERDUB</div>
    <div class="transport">
      <button class="tBtn ${state.isPlaying ? "active" : ""}" id="playBtn">${state.isPlaying ? "■" : "▶"}</button>
      <div class="bpmBox"><label>BPM</label><input type="number" id="bpmInput" min="40" max="220" value="${state.bpm}" ${state.isPlaying ? "disabled" : ""}/></div>
      <div class="bpmBox"><label>BARS</label><input type="number" id="barsInput" min="1" max="16" value="${state.bars}" ${state.isPlaying ? "disabled" : ""}/></div>
      <button class="tBtn ${state.metronomeOn ? "activeGreen" : ""}" id="metroBtn">♩</button>
    </div>
    <div class="loopBarWrap"><div class="loopBar"><div class="loopBarFill" id="loopBarFill" style="width:${state.loopPos * 100}%"></div></div></div>
    <button class="exportBtn" id="exportBtn" ${state.isRendering ? "disabled" : ""}>⬇ ${state.isRendering ? "Rendering…" : "Export WAV"}</button>
    <button class="installBtn" id="installBtn">⇩ Install App</button>
  `;
  document.getElementById("playBtn").onclick = () => (state.isPlaying ? handleStop() : handlePlay());
  document.getElementById("bpmInput").onchange = (e) => { state.bpm = Math.max(40, Math.min(220, Number(e.target.value) || 100)); Tone.Transport.bpm.rampTo(state.bpm, 0.1); rebuildParts(); rebuildClick(); };
  document.getElementById("barsInput").onchange = (e) => { state.bars = Math.max(1, Math.min(16, Number(e.target.value) || 4)); rebuildParts(); rebuildClick(); };
  document.getElementById("metroBtn").onclick = () => { state.metronomeOn = !state.metronomeOn; renderTopBar(); };
  document.getElementById("exportBtn").onclick = handleExport;
  const installBtn = document.getElementById("installBtn");
  if (state.deferredInstallPrompt) {
    installBtn.style.display = "flex";
    installBtn.onclick = async () => {
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      installBtn.style.display = "none";
    };
  }
}

function renderMidiStatus() {
  const el = document.getElementById("midiStatus");
  if (!el) return;
  el.innerHTML = `🎧 <span>${state.midiStatus}</span>` + (state.midiInputs.length > 1
    ? `<select id="midiSelect">${state.midiInputs.map((i) => `<option value="${i.id}" ${i.id === state.midiInputId ? "selected" : ""}>${i.name}</option>`).join("")}</select>`
    : "");
  const sel = document.getElementById("midiSelect");
  if (sel) sel.onchange = (e) => { state.midiInputId = e.target.value; bindMidiInput(state.midiInputs.find((i) => i.id === e.target.value)); renderMidiStatus(); };
}

function renderExportBar() {
  const el = document.getElementById("exportBar");
  if (!state.exportUrl) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="exportBar">
    <span>Render complete — 2 loops (${state.bars} bars each)</span>
    <a href="${state.exportUrl}" download="overdub-mix.wav">Download WAV</a>
    <button id="closeExport">✕</button>
  </div>`;
  document.getElementById("closeExport").onclick = () => { state.exportUrl = null; renderExportBar(); };
}

function renderAddForm() {
  const el = document.getElementById("addForm");
  if (!state.showAddTrack) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="addForm">
    <select id="patchSelect">${PATCHES.map((p) => `<option value="${p.id}" ${p.id === state.newPatch ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <button id="confirmAdd">Add Track</button>
  </div>`;
  document.getElementById("patchSelect").onchange = (e) => (state.newPatch = e.target.value);
  document.getElementById("confirmAdd").onclick = addTrack;
}

function renderTracks() {
  const el = document.getElementById("trackList");
  el.innerHTML = state.tracks.map((t, i) => {
    const color = TRACK_COLORS[i % TRACK_COLORS.length];
    const armed = state.armedTrackId === t.id;
    return `
      <div class="trackRow ${armed ? "armed" : ""}">
        <button class="armBtn ${armed ? "active" : ""}" data-arm="${t.id}">●</button>
        <div class="trackDot" style="background:${color}"></div>
        <div class="trackInfo"><div class="trackName">${t.name}</div><div class="trackMeta">${t.notes.length} notes</div></div>
        <button class="smallBtn ${t.muted ? "red" : ""}" data-mute="${t.id}">M</button>
        <button class="smallBtn ${t.solo ? "green" : ""}" data-solo="${t.id}">S</button>
        <input type="range" class="trackVol" min="0" max="1" step="0.01" value="${t.volume}" data-vol="${t.id}" />
        <button class="smallIconBtn" data-clear="${t.id}" title="Clear">🗑</button>
        <button class="smallIconBtn" data-remove="${t.id}" title="Remove">✕</button>
      </div>`;
  }).join("");

  el.querySelectorAll("[data-arm]").forEach((b) => (b.onclick = () => toggleArm(b.dataset.arm)));
  el.querySelectorAll("[data-mute]").forEach((b) => (b.onclick = () => toggleMute(b.dataset.mute)));
  el.querySelectorAll("[data-solo]").forEach((b) => (b.onclick = () => toggleSolo(b.dataset.solo)));
  el.querySelectorAll("[data-vol]").forEach((b) => (b.oninput = (e) => setVolume(b.dataset.vol, Number(e.target.value))));
  el.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => clearTrack(b.dataset.clear)));
  el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => removeTrack(b.dataset.remove)));

  const hint = document.getElementById("armHint");
  if (hint) {
    const armedTrack = state.tracks.find((t) => t.id === state.armedTrackId);
    hint.innerHTML = armedTrack
      ? `Recording into <strong style="color:${TRACK_COLORS[state.tracks.indexOf(armedTrack) % TRACK_COLORS.length]}">${armedTrack.name}</strong> — press Play, then play the keyboard. It loops every ${state.bars} bars.`
      : "Arm a track (red dot) to record into it, then hit Play. Unarmed, you'll just hear the current mix while you play along.";
  }
}

function renderTransport() { renderTopBar(); }

function renderVirtualKeys() {
  const el = document.getElementById("virtualKeys");
  const range = Array.from({ length: 25 }, (_, i) => 48 + i);
  el.innerHTML = range.map((m) => {
    const isBlack = NOTE_NAMES[m % 12].includes("#");
    return `<button class="vKey ${isBlack ? "black" : "white"}" data-note="${m}"></button>`;
  }).join("");
  el.querySelectorAll("[data-note]").forEach((k) => {
    const m = Number(k.dataset.note);
    k.addEventListener("mousedown", async () => { await ensureAudio(); noteOn(m); });
    k.addEventListener("mouseup", () => noteOff(m));
    k.addEventListener("mouseleave", (e) => { if (e.buttons === 1) noteOff(m); });
    k.addEventListener("touchstart", async (e) => { e.preventDefault(); await ensureAudio(); noteOn(m); }, { passive: false });
    k.addEventListener("touchend", (e) => { e.preventDefault(); noteOff(m); }, { passive: false });
  });
}

// ---------- PWA install prompt ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  renderTopBar();
});

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------- Boot ----------
setupAudioGraph();
setupMidi();
render();
