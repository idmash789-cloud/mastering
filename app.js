'use strict';
/* ============================================================
   Mastering Audio — mastering & mix backsound 100% lokal di browser.
   Fungsi murni (analisis, gain normalisasi, encoder WAV) diekspor
   untuk pengujian Node di bagian bawah file.
   ============================================================ */

// ---------- Fungsi murni ----------
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function analyzeChannels(channels) {
  var peak = 0, sum = 0, n = 0;
  for (var c = 0; c < channels.length; c++) {
    var d = channels[c];
    for (var i = 0; i < d.length; i++) {
      var a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i]; n++;
    }
  }
  return { peak: peak, rms: n ? Math.sqrt(sum / n) : 0 };
}
var NORM_TARGET = { soft: 0.060, normal: 0.085 };
function computeNormalizeGain(peak, rms, mode) {
  if (!mode || mode === 'off' || !rms || !peak) return 1;
  var target = NORM_TARGET[mode] || NORM_TARGET.normal;
  var g = target / rms;
  var ceil = 0.89 / peak;               // jangan lewati -1 dBFS
  if (g > ceil) g = ceil;
  if (g < 0.25) g = 0.25;
  if (g > 4) g = 4;
  return g;
}
function encodeWAV(channels, sampleRate) {
  var numCh = Math.min(2, channels.length) || 1;
  var len = channels[0].length;
  var bytesPerSample = 2, blockAlign = numCh * bytesPerSample;
  var dataSize = len * blockAlign;
  var buffer = new ArrayBuffer(44 + dataSize);
  var v = new DataView(buffer);
  function ws(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  var off = 44;
  for (var i = 0; i < len; i++) {
    for (var c = 0; c < numCh; c++) {
      var s = Math.max(-1, Math.min(1, channels[numCh === 1 ? 0 : c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Uint8Array(buffer);
}
function floatToInt16(arr) {
  var out = new Int16Array(arr.length);
  for (var i = 0; i < arr.length; i++) {
    var s = Math.max(-1, Math.min(1, arr[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

// ---------- Preset bawaan ----------
var PRESETS = {
  hypnokids: { label: 'HypnoKids Lembut (andalan)', bass: 2, mid: 2.5, treble: -4, echo: 0, noise: 25, width: 100, warmFreq: 8500, normalize: 'normal' },
  jernih:    { label: 'Jernih Cerita', bass: 0, mid: 3, treble: 3, echo: 0, noise: 35, width: 110, warmFreq: 16000, normalize: 'normal' },
  hangat:    { label: 'Hangat Malam', bass: 4, mid: 1, treble: -6, echo: 6, noise: 15, width: 90, warmFreq: 7000, normalize: 'soft' },
  musik:     { label: 'Musik Ringan', bass: 5, mid: 0, treble: 2, echo: 10, noise: 5, width: 140, warmFreq: 18500, normalize: 'normal' },
  asli:      { label: 'Asli (bypass)', bass: 0, mid: 0, treble: 0, echo: 0, noise: 0, width: 100, warmFreq: 18500, normalize: 'off' }
};
var LS_KEY = 'masteringAudio.customPresets.v1';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtTime: fmtTime, analyzeChannels: analyzeChannels, computeNormalizeGain: computeNormalizeGain, encodeWAV: encodeWAV, floatToInt16: floatToInt16, PRESETS: PRESETS };
}

/* ============================================================
   APLIKASI BROWSER
   ============================================================ */
if (typeof document !== 'undefined') (function () {
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    fileMain: $('fileMain'), fileBack: $('fileBack'), dropMain: $('dropMain'), dropBack: $('dropBack'),
    infoMain: $('infoMain'), infoBack: $('infoBack'), wave: $('waveMain'),
    btnPlay: $('btnPlay'), btnStop: $('btnStop'), timePos: $('timePos'), timeDur: $('timeDur'),
    chkNormalize: $('chkNormalize'), levelInfo: $('levelInfo'),
    selPreset: $('selPreset'), btnSavePreset: $('btnSavePreset'), btnDeletePreset: $('btnDeletePreset'),
    btnAsli: $('btnAsli'), btnMaster: $('btnMaster'),
    slBackVol: $('slBackVol'), slFadeIn: $('slFadeIn'), slFadeOut: $('slFadeOut'),
    chkLoop: $('chkLoop'), chkMuteMain: $('chkMuteMain'), chkMuteBack: $('chkMuteBack'),
    selExportMode: $('selExportMode'), selFormat: $('selFormat'), selBitrate: $('selBitrate'),
    btnExport: $('btnExport'), linkDownload: $('linkDownload'),
    progressBar: $('progressBar'), exportStatus: $('exportStatus'), mp3Note: $('mp3Note')
  };
  var SLIDERS = ['Bass', 'Mid', 'Treble', 'Echo', 'Noise', 'Width', 'MasterVol'];
  var sl = {}, out = {};
  SLIDERS.forEach(function (k) { sl[k] = $('sl' + k); out[k] = $('out' + k); });

  var state = {
    ctx: null, chain: null, master: null, analyser: null,
    chainBus: null, bypassBus: null, backVol: null, backFade: null,
    mainBuffer: null, backBuffer: null, mainName: 'audio', backName: '',
    mainSrc: null, backSrc: null, playing: false, startAt: 0, offset: 0,
    mode: 'master', warmFreq: 8500, normalizeMode: 'normal',
    gateTimer: null, raf: 0, mainStats: null, downloadUrl: null
  };

  // ---------- Parameter dari UI ----------
  function readParams() {
    return {
      bass: parseFloat(sl.Bass.value), mid: parseFloat(sl.Mid.value), treble: parseFloat(sl.Treble.value),
      echo: parseFloat(sl.Echo.value), noise: parseFloat(sl.Noise.value),
      width: parseFloat(sl.Width.value) / 100, warmFreq: state.warmFreq,
      normalize: els.chkNormalize.checked ? state.normalizeMode : 'off',
      mainStats: state.mainStats
    };
  }
  function refreshOutputs() {
    out.Bass.textContent = sl.Bass.value + ' dB';
    out.Mid.textContent = sl.Mid.value + ' dB';
    out.Treble.textContent = sl.Treble.value + ' dB';
    out.Echo.textContent = sl.Echo.value;
    out.Noise.textContent = sl.Noise.value;
    out.Width.textContent = sl.Width.value;
    out.MasterVol.textContent = sl.MasterVol.value + '%';
    $('outBackVol').textContent = els.slBackVol.value + '%';
    $('outFadeIn').textContent = els.slFadeIn.value + ' dtk';
    $('outFadeOut').textContent = els.slFadeOut.value + ' dtk';
  }

  // ---------- Pembangun rantai mastering (dipakai realtime & offline) ----------
  function buildChain(ctx, p) {
    var input = ctx.createGain();
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = 25 + p.noise * 2.5; hp.Q.value = 0.7;
    var gate = ctx.createGain();
    var eqLow = ctx.createBiquadFilter(); eqLow.type = 'lowshelf'; eqLow.frequency.value = 200; eqLow.gain.value = p.bass;
    var eqMid = ctx.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.9; eqMid.gain.value = p.mid;
    var eqHigh = ctx.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4200; eqHigh.gain.value = p.treble;
    var warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = p.warmFreq || 18500; warm.Q.value = 0.4;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.28;
    var bus = ctx.createGain();
    // Echo: kiriman paralel dari comp ke bus
    var delay = ctx.createDelay(1); delay.delayTime.value = 0.19;
    var fb = ctx.createGain(); fb.gain.value = 0.32;
    var echoIn = ctx.createGain(); echoIn.gain.value = (p.echo / 100) * 0.6;
    comp.connect(delay); delay.connect(fb); fb.connect(delay);
    comp.connect(echoIn); echoIn.connect(delay); delay.connect(bus);
    comp.connect(bus);
    // Lebar stereo (mid-side)
    var splitter = ctx.createChannelSplitter(2);
    var merger = ctx.createChannelMerger(2);
    bus.connect(splitter);
    var mid = ctx.createGain(), side = ctx.createGain();
    function g(val, from, chan, to) { var n = ctx.createGain(); n.gain.value = val; from.connect(n, chan); n.connect(to); return n; }
    g(0.5, splitter, 0, mid); g(0.5, splitter, 1, mid);
    g(0.5, splitter, 0, side); g(-0.5, splitter, 1, side);
    var sideW = ctx.createGain(); sideW.gain.value = p.width; side.connect(sideW);
    var mL = ctx.createGain(), mR = ctx.createGain(); mid.connect(mL); mid.connect(mR);
    mL.connect(merger, 0, 0); mR.connect(merger, 0, 1);
    var sL = ctx.createGain(); sL.gain.value = 1; sideW.connect(sL); sL.connect(merger, 0, 0);
    var sR = ctx.createGain(); sR.gain.value = -1; sideW.connect(sR); sR.connect(merger, 0, 1);
    // Limiter + normalisasi
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.24;
    var norm = ctx.createGain();
    norm.gain.value = p.mainStats ? computeNormalizeGain(p.mainStats.peak, p.mainStats.rms, p.normalize) : 1;
    merger.connect(limiter); limiter.connect(norm);
    input.connect(hp); hp.connect(gate); gate.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
    eqHigh.connect(warm); warm.connect(comp);
    return {
      input: input, output: norm,
      setParams: function (q) {
        hp.frequency.setTargetAtTime(25 + q.noise * 2.5, ctx.currentTime, 0.03);
        eqLow.gain.setTargetAtTime(q.bass, ctx.currentTime, 0.03);
        eqMid.gain.setTargetAtTime(q.mid, ctx.currentTime, 0.03);
        eqHigh.gain.setTargetAtTime(q.treble, ctx.currentTime, 0.03);
        warm.frequency.setTargetAtTime(q.warmFreq || 18500, ctx.currentTime, 0.03);
        echoIn.gain.setTargetAtTime((q.echo / 100) * 0.6, ctx.currentTime, 0.03);
        sideW.gain.setTargetAtTime(q.width, ctx.currentTime, 0.03);
        norm.gain.setTargetAtTime(q.mainStats ? computeNormalizeGain(q.mainStats.peak, q.mainStats.rms, q.normalize) : 1, ctx.currentTime, 0.05);
      },
      setGate: function (v) { gate.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
      analyserIn: input
    };
  }
  // Sumber mono → stereo (duplikasi kanal) agar tahap lebar stereo aman
  function connectSource(ctx, src, buffer, target) {
    if (buffer.numberOfChannels === 1) {
      var merger = ctx.createChannelMerger(2);
      src.connect(merger, 0, 0); src.connect(merger, 0, 1); merger.connect(target);
    } else src.connect(target);
  }
  // Gate offline: terapkan selubung gate per-bingkai 25 ms langsung ke sampel
  function makeGatedBuffer(ctx, buffer, noiseVal) {
    var thr = 0.002 + (noiseVal / 100) * 0.03;
    var outBuf = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    var frame = Math.floor(buffer.sampleRate * 0.025), gain = 0, step = Math.floor(buffer.sampleRate * 0.005) || 1;
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      var d = buffer.getChannelData(c), o = outBuf.getChannelData(c);
      gain = 0;
      for (var i = 0; i < d.length; i++) {
        if (i % frame === 0) {
          var sum = 0, cnt = 0;
          for (var j = i; j < Math.min(i + frame, d.length); j += 4) { sum += d[j] * d[j]; cnt++; }
          var rms = Math.sqrt(sum / (cnt || 1));
          gain = rms > thr ? 1 : 0.1;
        }
        var target = (Math.abs(d[Math.min(i, d.length - 1)]) >= 0 || gain);
        o[i] = d[i] * gain;
      }
    }
    return outBuf;
  }

  // ---------- Inisialisasi konteks realtime ----------
  function ensureCtx() {
    if (state.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    state.ctx = new AC();
    state.chain = buildChain(state.ctx, readParams());
    state.master = state.ctx.createGain();
    state.analyser = state.ctx.createAnalyser(); state.analyser.fftSize = 512;
    state.chainBus = state.ctx.createGain();
    state.bypassBus = state.ctx.createGain(); state.bypassBus.gain.value = 0;
    state.backVol = state.ctx.createGain(); state.backFade = state.ctx.createGain();
    state.chain.output.connect(state.chainBus); state.chainBus.connect(state.master);
    state.bypassBus.connect(state.master);
    state.backVol.connect(state.backFade); state.backFade.connect(state.master);
    state.master.connect(state.analyser); state.analyser.connect(state.ctx.destination);
    applyVolumes();
    // Gate realtime: pantau level input, redam saat di bawah ambang
    var buf = new Float32Array(state.analyser.fftSize);
    state.gateTimer = setInterval(function () {
      if (!state.chain) return;
      var p = readParams();
      if (p.noise <= 0) { state.chain.setGate(1); return; }
      state.analyser.getFloatTimeDomainData(buf);
      var sum = 0; for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      var rms = Math.sqrt(sum / buf.length);
      var thr = 0.002 + (p.noise / 100) * 0.03;
      state.chain.setGate(rms > thr ? 1 : 0.1);
    }, 90);
  }
  function applyVolumes() {
    if (!state.ctx) return;
    var t = state.ctx.currentTime;
    state.master.gain.setTargetAtTime(parseFloat(sl.MasterVol.value) / 100, t, 0.03);
    state.backVol.gain.setTargetAtTime(els.chkMuteBack.checked ? 0 : parseFloat(els.slBackVol.value) / 100, t, 0.03);
    if (state.chainBus) state.chainBus.gain.setTargetAtTime(state.mode === 'master' && !els.chkMuteMain.checked ? 1 : 0, t, 0.02);
    if (state.bypassBus) state.bypassBus.gain.setTargetAtTime(state.mode === 'asli' && !els.chkMuteMain.checked ? 1 : 0, t, 0.02);
  }

  // ---------- Muat file ----------
  function decodeFile(file, cb) {
    ensureCtx();
    file.arrayBuffer().then(function (ab) {
      return state.ctx.decodeAudioData(ab);
    }).then(function (buf) { cb(null, buf); }).catch(function (e) { cb(e); });
  }
  function loadMain(file) {
    if (!file) return;
    decodeFile(file, function (err, buf) {
      if (err) { els.infoMain.textContent = 'Gagal membaca file: ' + err.message; return; }
      stopPlayback(); state.offset = 0;
      state.mainBuffer = buf; state.mainName = file.name.replace(/\.[^.]+$/, '');
      var chans = []; for (var c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      state.mainStats = analyzeChannels(chans);
      els.infoMain.textContent = file.name + ' · ' + fmtTime(buf.duration) + ' · ' + buf.numberOfChannels + ' kanal · ' + buf.sampleRate + ' Hz';
      els.timeDur.textContent = fmtTime(buf.duration);
      els.btnPlay.disabled = false; els.btnStop.disabled = false; els.btnExport.disabled = false;
      updateLevelInfo(); drawWave(0);
      if (state.chain) state.chain.setParams(readParams());
    });
  }
  function loadBack(file) {
    if (!file) return;
    decodeFile(file, function (err, buf) {
      if (err) { els.infoBack.textContent = 'Gagal membaca backsound: ' + err.message; return; }
      state.backBuffer = buf; state.backName = file.name;
      els.infoBack.textContent = file.name + ' · ' + fmtTime(buf.duration) + ' · ' + buf.numberOfChannels + ' kanal';
    });
  }
  function updateLevelInfo() {
    if (!state.mainStats) return;
    var p = readParams();
    var g = computeNormalizeGain(state.mainStats.peak, state.mainStats.rms, p.normalize);
    var peakDb = (20 * Math.log10(state.mainStats.peak || 1e-6)).toFixed(1);
    var afterDb = (20 * Math.log10(Math.min(1, state.mainStats.peak * g) || 1e-6)).toFixed(1);
    els.levelInfo.textContent = 'Peak sebelum: ' + peakDb + ' dBFS · Perkiraan sesudah normalisasi (×' + g.toFixed(2) + '): ' + afterDb + ' dBFS';
  }

  // ---------- Waveform ----------
  function drawWave(progress) {
    var cv = els.wave, ctx2 = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx2.fillStyle = '#0d1116'; ctx2.fillRect(0, 0, W, H);
    if (!state.mainBuffer) { ctx2.fillStyle = '#435364'; ctx2.font = '13px sans-serif'; ctx2.fillText('Waveform akan tampil di sini setelah audio dimuat', 14, H / 2); return; }
    var d = state.mainBuffer.getChannelData(0);
    var step = Math.ceil(d.length / W), mid = H / 2;
    for (var x = 0; x < W; x++) {
      var min = 1, max = -1;
      for (var i = 0; i < step; i += 8) { var v = d[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
      var played = (x / W) <= (progress || 0);
      ctx2.fillStyle = played ? '#e8b34b' : '#3fa7a0';
      ctx2.fillRect(x, mid + min * mid * 0.95, 1, Math.max(1, (max - min) * mid * 0.95));
    }
    if (progress > 0) { ctx2.fillStyle = '#e8edf2'; ctx2.fillRect(W * progress, 0, 1.5, H); }
  }
  els.wave.addEventListener('click', function (e) {
    if (!state.mainBuffer) return;
    var r = els.wave.getBoundingClientRect();
    var ratio = (e.clientX - r.left) / r.width;
    seekTo(ratio * state.mainBuffer.duration);
  });

  // ---------- Transport ----------
  function seekTo(sec) {
    sec = Math.max(0, Math.min(sec, state.mainBuffer ? state.mainBuffer.duration : 0));
    var wasPlaying = state.playing;
    if (wasPlaying) startSources(sec); else { state.offset = sec; drawWave(state.mainBuffer ? sec / state.mainBuffer.duration : 0); els.timePos.textContent = fmtTime(sec); }
  }
  function startSources(offset) {
    stopSourcesOnly();
    var ctx = state.ctx, t = ctx.currentTime + 0.05;
    var ms = ctx.createBufferSource(); ms.buffer = state.mainBuffer;
    connectSource(ctx, ms, state.mainBuffer, state.chain.input);
    ms.connect(state.bypassBus);
    state.mainSrc = ms;
    if (state.backBuffer) {
      var bs = ctx.createBufferSource(); bs.buffer = state.backBuffer;
      bs.loop = els.chkLoop.checked; if (bs.loop) bs.loopEnd = state.backBuffer.duration;
      connectSource(ctx, bs, state.backBuffer, state.backVol);
      state.backSrc = bs;
      // Fade backsound (preview realtime, pendekatan dari jadwal fade export)
      var fi = parseFloat(els.slFadeIn.value), fo = parseFloat(els.slFadeOut.value);
      var gnode = state.backFade.gain;
      gnode.cancelScheduledValues(t);
      gnode.setValueAtTime(fi > 0 ? 0 : 1, t);
      if (fi > 0) gnode.linearRampToValueAtTime(1, t + fi);
      if (fo > 0 && state.mainBuffer) {
        var remain = state.mainBuffer.duration - offset;
        if (remain > fo) { gnode.setValueAtTime(1, t + remain - fo); gnode.linearRampToValueAtTime(0, t + remain); }
      }
      bs.start(t, els.chkLoop.checked ? (offset % state.backBuffer.duration) : Math.min(offset, state.backBuffer.duration));
      if (!els.chkLoop.checked && offset >= state.backBuffer.duration) { try { bs.stop(t); } catch (e) {} }
    }
    ms.start(t, offset);
    ms.onended = function () { if (state.playing && currentPos() >= (state.mainBuffer.duration - 0.15)) stopPlayback(true); };
    state.startAt = ctx.currentTime; state.offset = offset; state.playing = true;
    els.btnPlay.textContent = '⏸ Jeda';
    tick();
  }
  function stopSourcesOnly() {
    [state.mainSrc, state.backSrc].forEach(function (s) { if (s) { try { s.onended = null; s.stop(); } catch (e) {} } });
    state.mainSrc = null; state.backSrc = null;
  }
  function currentPos() {
    if (!state.playing) return state.offset;
    return Math.min(state.offset + (state.ctx.currentTime - state.startAt), state.mainBuffer ? state.mainBuffer.duration : 0);
  }
  function stopPlayback(ended) {
    if (state.playing) state.offset = ended ? 0 : currentPos();
    stopSourcesOnly(); state.playing = false;
    if (ended) state.offset = 0;
    els.btnPlay.textContent = '▶ Putar';
    cancelAnimationFrame(state.raf);
    els.timePos.textContent = fmtTime(state.offset);
    drawWave(state.mainBuffer ? state.offset / state.mainBuffer.duration : 0);
  }
  function tick() {
    if (!state.playing) return;
    var pos = currentPos();
    els.timePos.textContent = fmtTime(pos);
    drawWave(state.mainBuffer ? pos / state.mainBuffer.duration : 0);
    state.raf = requestAnimationFrame(tick);
  }
  els.btnPlay.addEventListener('click', function () {
    if (!state.mainBuffer) return;
    ensureCtx(); if (state.ctx.state === 'suspended') state.ctx.resume();
    if (state.playing) stopPlayback(false); else startSources(state.offset);
  });
  els.btnStop.addEventListener('click', function () { stopPlayback(false); state.offset = 0; els.timePos.textContent = '0:00'; drawWave(0); });

  // ---------- Mode Asli vs Master ----------
  function setMode(m) {
    state.mode = m;
    els.btnAsli.classList.toggle('active', m === 'asli');
    els.btnMaster.classList.toggle('active', m === 'master');
    applyVolumes();
  }
  els.btnAsli.addEventListener('click', function () { setMode('asli'); });
  els.btnMaster.addEventListener('click', function () { setMode('master'); });

  // ---------- Slider & preset ----------
  SLIDERS.forEach(function (k) {
    sl[k].addEventListener('input', function () {
      refreshOutputs();
      if (state.chain) state.chain.setParams(readParams());
      if (k === 'MasterVol') applyVolumes();
      updateLevelInfo();
    });
  });
  [els.slBackVol].forEach(function (s) { s.addEventListener('input', function () { refreshOutputs(); applyVolumes(); }); });
  [els.chkMuteMain, els.chkMuteBack].forEach(function (c) { c.addEventListener('change', applyVolumes); });
  els.chkNormalize.addEventListener('change', function () { if (state.chain) state.chain.setParams(readParams()); updateLevelInfo(); });

  function loadCustomPresets() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function rebuildPresetSelect(selected) {
    els.selPreset.innerHTML = '';
    var g1 = document.createElement('optgroup'); g1.label = 'Preset bawaan';
    Object.keys(PRESETS).forEach(function (k) { var o = document.createElement('option'); o.value = 'base:' + k; o.textContent = PRESETS[k].label; g1.appendChild(o); });
    els.selPreset.appendChild(g1);
    var customs = loadCustomPresets(), names = Object.keys(customs);
    if (names.length) {
      var g2 = document.createElement('optgroup'); g2.label = 'Preset saya';
      names.forEach(function (n) { var o = document.createElement('option'); o.value = 'custom:' + n; o.textContent = n; g2.appendChild(o); });
      els.selPreset.appendChild(g2);
    }
    if (selected) els.selPreset.value = selected;
  }
  function applyPreset(p) {
    sl.Bass.value = p.bass; sl.Mid.value = p.mid; sl.Treble.value = p.treble;
    sl.Echo.value = p.echo; sl.Noise.value = p.noise; sl.Width.value = p.width;
    state.warmFreq = p.warmFreq || 18500; state.normalizeMode = p.normalize || 'normal';
    els.chkNormalize.checked = p.normalize !== 'off';
    refreshOutputs();
    if (state.chain) state.chain.setParams(readParams());
    updateLevelInfo();
  }
  els.selPreset.addEventListener('change', function () {
    var v = els.selPreset.value;
    if (v.indexOf('base:') === 0) applyPreset(PRESETS[v.slice(5)]);
    else if (v.indexOf('custom:') === 0) { var c = loadCustomPresets()[v.slice(7)]; if (c) applyPreset(c); }
  });
  els.btnSavePreset.addEventListener('click', function () {
    var name = prompt('Nama preset baru:');
    if (!name) return;
    var customs = loadCustomPresets();
    var p = readParams();
    customs[name] = { bass: p.bass, mid: p.mid, treble: p.treble, echo: p.echo, noise: p.noise, width: Math.round(p.width * 100), warmFreq: state.warmFreq, normalize: els.chkNormalize.checked ? state.normalizeMode : 'off' };
    localStorage.setItem(LS_KEY, JSON.stringify(customs));
    rebuildPresetSelect('custom:' + name);
    alert('Preset "' + name + '" tersimpan di browser ini.');
  });
  els.btnDeletePreset.addEventListener('click', function () {
    var v = els.selPreset.value;
    if (v.indexOf('custom:') !== 0) { alert('Pilih preset buatan Anda dulu untuk menghapus.'); return; }
    var customs = loadCustomPresets(); delete customs[v.slice(7)];
    localStorage.setItem(LS_KEY, JSON.stringify(customs));
    rebuildPresetSelect('base:hypnokids'); applyPreset(PRESETS.hypnokids);
  });

  // ---------- File input & drag-drop ----------
  els.fileMain.addEventListener('change', function () { loadMain(els.fileMain.files[0]); });
  els.fileBack.addEventListener('change', function () { loadBack(els.fileBack.files[0]); });
  [['dropMain', 'main'], ['dropBack', 'back']].forEach(function (pair) {
    var dz = els[pair[0]];
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('drag');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (pair[1] === 'main') loadMain(f); else loadBack(f);
    });
  });

  // ---------- Export (OfflineAudioContext) ----------
  function encodeMP3(channels, bitrate) {
    if (!(window.lamejs && window.lamejs.Mp3Encoder)) return null;
    var enc = new window.lamejs.Mp3Encoder(channels.length > 1 ? 2 : 1, 44100, bitrate);
    var left = floatToInt16(channels[0]);
    var right = channels.length > 1 ? floatToInt16(channels[1]) : left;
    var parts = [], block = 1152;
    for (var i = 0; i < left.length; i += block) {
      var l = left.subarray(i, i + block), r = right.subarray(i, i + block);
      var d = channels.length > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (d.length) parts.push(d);
    }
    var end = enc.flush(); if (end.length) parts.push(end);
    return new Blob(parts, { type: 'audio/mpeg' });
  }
  els.btnExport.addEventListener('click', function () {
    if (!state.mainBuffer) return;
    var mode = els.selExportMode.value, format = els.selFormat.value, bitrate = parseInt(els.selBitrate.value, 10);
    var dur = state.mainBuffer.duration, sr = 44100;
    var off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    var p = readParams();
    var chain = buildChain(off, p);
    var srcBuf = state.mainBuffer;
    if (p.noise > 2) { try { srcBuf = makeGatedBuffer(off, state.mainBuffer, p.noise); } catch (e) { srcBuf = state.mainBuffer; } }
    var ms = off.createBufferSource(); ms.buffer = srcBuf;
    connectSource(off, ms, srcBuf, chain.input);
    chain.output.connect(off.destination);
    if (mode === 'mix' && state.backBuffer) {
      var bs = off.createBufferSource(); bs.buffer = state.backBuffer;
      bs.loop = els.chkLoop.checked; if (bs.loop) bs.loopEnd = state.backBuffer.duration;
      var bv = off.createGain(); bv.gain.value = els.chkMuteBack.checked ? 0 : parseFloat(els.slBackVol.value) / 100;
      var bf = off.createGain();
      connectSource(off, bs, state.backBuffer, bv); bv.connect(bf); bf.connect(off.destination);
      var fi = parseFloat(els.slFadeIn.value), fo = parseFloat(els.slFadeOut.value);
      bf.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
      if (fi > 0) bf.gain.linearRampToValueAtTime(1, fi);
      if (fo > 0 && dur > fo) { bf.gain.setValueAtTime(1, dur - fo); bf.gain.linearRampToValueAtTime(0, dur); }
      bs.start(0);
    }
    ms.start(0);
    els.btnExport.disabled = true;
    els.exportStatus.textContent = 'Merender… jangan tutup tab ini.';
    els.linkDownload.classList.add('hidden');
    var fake = 0;
    var iv = setInterval(function () { fake = Math.min(92, fake + 4); els.progressBar.style.width = fake + '%'; }, 180);
    off.startRendering().then(function (rendered) {
      clearInterval(iv); els.progressBar.style.width = '100%';
      var chans = [rendered.getChannelData(0), rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)];
      var stats = analyzeChannels(chans);
      var blob, ext = format;
      if (format === 'mp3') {
        blob = encodeMP3(chans, bitrate);
        if (!blob) { blob = new Blob([encodeWAV(chans, sr)], { type: 'audio/wav' }); ext = 'wav'; els.exportStatus.textContent = 'Library MP3 tidak tersedia — hasil diberikan sebagai WAV.'; }
      } else {
        blob = new Blob([encodeWAV(chans, sr)], { type: 'audio/wav' });
      }
      if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = URL.createObjectURL(blob);
      var fname = state.mainName + (mode === 'mix' ? '_mix' : '_master') + '.' + ext;
      els.linkDownload.href = state.downloadUrl; els.linkDownload.download = fname;
      els.linkDownload.textContent = '⬇ Unduh ' + fname + ' (' + (blob.size / 1024 / 1024).toFixed(2) + ' MB)';
      els.linkDownload.classList.remove('hidden');
      els.exportStatus.textContent = 'Render selesai · Peak hasil: ' + (20 * Math.log10(stats.peak || 1e-6)).toFixed(1) + ' dBFS · RMS: ' + (20 * Math.log10(stats.rms || 1e-6)).toFixed(1) + ' dBFS';
      els.btnExport.disabled = false;
      setTimeout(function () { els.progressBar.style.width = '0%'; }, 1200);
    }).catch(function (e) {
      clearInterval(iv); els.progressBar.style.width = '0%';
      els.exportStatus.textContent = 'Render gagal: ' + e.message;
      els.btnExport.disabled = false;
    });
  });

  // ---------- Init ----------
  rebuildPresetSelect('base:hypnokids');
  applyPreset(PRESETS.hypnokids);
  refreshOutputs();
  drawWave(0);
  if (!(window.lamejs && window.lamejs.Mp3Encoder)) {
    els.mp3Note.textContent = 'Catatan: library MP3 (lamejs) tidak termuat — export MP3 akan otomatis diberikan sebagai WAV.';
  }
})();
