'use strict';

// ---------- Konfiguration ----------
const APP = 'Xviews Glotzofon';
const GITHUB = 'https://github.com/xviews/xviews-glotzofon';
const WEB_VIEWER = 'https://xviews.github.io/xviews-glotzofon/'; // Zuschauen im Browser (GitHub Pages)
const DOWNLOAD = GITHUB + '/releases/latest/download/XviewsGlotzofon.exe';
const ID_PREFIX = 'glotzofon-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I/L
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const QUALITY = {
  detail: { fps: 30, bitrate: 12, hint: 'detail', degradation: 'maintain-resolution' },
  motion: { fps: 60, bitrate: 20, hint: 'motion', degradation: 'maintain-framerate' },
};

// Standardwerte wie in settings.go (falls die Seite ohne die EXE läuft).
const DEFAULTS = {
  quality: 'detail', maxHeight: 0, maxBitrate: 0, shareAudio: true, autoCopyCode: true, theme: 'system', lang: 'auto', gpu: 'high', codec: 'auto', shareView: 'bar',
  updateCheck: 'daily', fixedCode: false, myCode: '', internetEnabled: true, directEnabled: false, directPort: 47800,
  server: { custom: false, host: '', port: 443, path: '/', secure: true, key: 'peerjs' },
  turn: { url: '', username: '', credential: '' },
};
let settings = structuredClone(DEFAULTS);
let startGpu = DEFAULTS.gpu; // Grafikkarten-Wahl beim Start (Änderung wirkt erst nach Neustart)

// ---------- Helfer ----------
// Achtung: Die Go-Bindings (main.go, w.Bind) liegen als window.<name> im globalen Bereich.
// Eine JS-Funktion mit demselben Namen überdeckt sie (Endlosschleife) – also nie gleich benennen.
const $ = (id) => document.getElementById(id);
const native = (name) => typeof window[name] === 'function';

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screen));
  document.querySelectorAll('.appbar-nav [data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === screen));
  document.body.classList.toggle('viewing', screen === 'viewer'); // Video bekommt die ganze Fläche
}

function updateTitle(t) {
  document.title = t;
  if (native('setTitle')) window.setTitle(t).catch(() => {}); // Go-Binding
}

function homeMessage(text) {
  $('homeMsg').textContent = text || '';
}

function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(6));
  const s = Array.from(r, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
  return s.slice(0, 3) + '-' + s.slice(3);
}

function normalizeCode(raw) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? s.slice(0, 3) + '-' + s.slice(3) : null;
}

const peerIdFor = (code) => ID_PREFIX + code.replace('-', '').toLowerCase();

function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, v) { try { localStorage.setItem(key, v); } catch { /* egal */ } }

// ---------- Verbindungswege ----------
function iceServers() {
  const list = [...STUN];
  if (settings.turn.url) list.push({ urls: settings.turn.url, username: settings.turn.username, credential: settings.turn.credential });
  return list;
}

// Über Code: öffentlicher oder eigener PeerJS-Vermittlungsserver.
function internetOpts() {
  const o = { debug: 1, config: { iceServers: iceServers() } };
  const s = settings.server;
  if (s.custom && s.host) {
    Object.assign(o, { host: s.host, port: Number(s.port) || 443, path: s.path || '/', secure: !!s.secure, key: s.key || 'peerjs' });
  }
  return o;
}

// Direkt: der eingebaute Mini-Server der teilenden Glotzofon (peerserver.go).
function directOpts(host, port) {
  return { debug: 1, host, port, path: '/', secure: false, key: 'peerjs', config: { iceServers: iceServers() } };
}

// "192.168.1.20", "192.168.1.20:47800", "[fe80::1]:47800", "pc-name"
function parseAddress(raw) {
  const s = raw.trim();
  if (!s) return null;
  let m = /^\[([0-9a-f:.%]+)\](?::(\d+))?$/i.exec(s);
  if (m) return { host: '[' + m[1] + ']', port: Number(m[2]) || settings.directPort };
  if ((s.match(/:/g) || []).length > 1) return { host: '[' + s + ']', port: settings.directPort }; // IPv6 ohne Port
  m = /^([^:\s]+)(?::(\d+))?$/.exec(s);
  return m ? { host: m[1], port: Number(m[2]) || settings.directPort } : null;
}

// ---------- Codecs: nur lizenzfreie ----------
// Erlaubt sind ausschließlich AV1, VP9 und VP8 (lizenzfrei). H.264/H.265 werden aus dem
// Verbindungsangebot (SDP) entfernt und können so nie ausgehandelt werden.
const FREE_CODECS = ['AV1', 'VP9', 'VP8'];
const HELPER_CODECS = ['rtx', 'red', 'ulpfec', 'flexfec-03']; // Fehlerschutz, gehört zum Haupt-Codec

let autoCodec = 'AV1'; // Ergebnis von detectAutoCodec()

function codecOrder() {
  const first = { av1: 'AV1', vp9: 'VP9', vp8: 'VP8' }[settings.codec] || autoCodec;
  return [first, ...FREE_CODECS.filter((c) => c !== first)];
}

// "Automatisch": AV1, wenn dieser PC es per Grafikkarte kodieren kann – sonst VP9 per CPU
// (deutlich sparsamer als AV1 in Software und gut für Bildschirminhalte).
async function detectAutoCodec(track) {
  const s = track.getSettings();
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: {
        contentType: 'video/AV1', width: s.width || 1920, height: s.height || 1080,
        framerate: host.quality.fps, bitrate: (settings.maxBitrate || host.quality.bitrate) * 1e6,
      },
    });
    autoCodec = info.supported && info.powerEfficient ? 'AV1' : 'VP9';
  } catch {
    autoCodec = 'VP9';
  }
  console.log('host: Codec automatisch ->', autoCodec);
}

// reorder=false (Antwort des Zuschauers): nur filtern, die Reihenfolge des Teilenden gilt.
function freeCodecsOnly(sdp, reorder = true) {
  const lines = sdp.split('\r\n');
  const mIdx = lines.findIndex((l) => l.startsWith('m=video'));
  if (mIdx < 0) return sdp;
  let end = lines.findIndex((l, i) => i > mIdx && l.startsWith('m='));
  if (end < 0) end = lines.length;

  const name = new Map(); // PT -> Codecname
  const apt = new Map();  // RTX-PT -> zugehöriger PT
  for (let i = mIdx; i < end; i++) {
    let m = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(lines[i]);
    if (m) name.set(m[1], m[2]);
    m = /^a=fmtp:(\d+) .*apt=(\d+)/.exec(lines[i]);
    if (m) apt.set(m[1], m[2]);
  }
  const order = codecOrder().map((c) => c.toUpperCase());
  const rank = (pt) => order.indexOf((name.get(pt) || '').toUpperCase());
  const keep = new Set([...name.keys()].filter((pt) => rank(pt) >= 0));
  for (const [pt, c] of name) {
    if (!HELPER_CODECS.includes(c.toLowerCase())) continue;
    if (apt.has(pt) ? keep.has(apt.get(pt)) : true) keep.add(pt); // RTX nur zu erlaubten Codecs
  }
  if (![...keep].some((pt) => rank(pt) >= 0)) return sdp; // Notfall: kein freier Codec – nichts verändern

  const parts = lines[mIdx].split(' ');
  const pts = parts.slice(3).filter((pt) => keep.has(pt));
  const main = pts.filter((pt) => rank(pt) >= 0);
  if (reorder) main.sort((a, b) => rank(a) - rank(b));
  lines[mIdx] = [...parts.slice(0, 3), ...main, ...pts.filter((pt) => rank(pt) < 0)].join(' ');

  const out = lines.filter((l, i) => {
    if (i <= mIdx || i >= end) return true;
    const m = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/.exec(l);
    return !m || keep.has(m[1]);
  });
  return out.join('\r\n');
}

const isNetError = (t) => t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed';

// ---------- Zeigen (Host) ----------
const host = {
  peers: [], stream: null, calls: new Map(), quality: QUALITY.detail, code: '', direct: null, directError: '', ready: false,
  live: { mode: 'detail', maxHeight: 0, maxBitrate: 0 }, lastCount: 0,
};

// Im Selbsttest (selftest.js) durch ein Testbild ersetzt.
// Aufgenommen wird immer in voller Auflösung und bis 60 fps; verkleinert und gedrosselt wird
// beim Senden (applyLive), damit die Schnellauswahl in beide Richtungen umschalten kann.
let captureScreen = (q) => {
  const video = { frameRate: { ideal: q.fps, max: 60 } };
  return navigator.mediaDevices.getDisplayMedia({
    video,
    audio: !!settings.shareAudio,
    systemAudio: settings.shareAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
  });
};

async function startHost() {
  homeMessage('');
  // Schnellauswahl startet mit den Werten der Startseite bzw. Einstellungen
  host.live = { mode: $('quality').value, maxHeight: settings.maxHeight, maxBitrate: settings.maxBitrate };
  host.quality = QUALITY[host.live.mode];
  const btn = $('btnShare');
  btn.disabled = true;

  try {
    host.stream = await captureScreen(host.quality);
  } catch (e) {
    btn.disabled = false;
    if (e.name !== 'NotAllowedError') homeMessage(t('Aufnahme nicht möglich: {e}', { e: e.message }));
    return;
  }

  const [vtrack] = host.stream.getVideoTracks();
  vtrack.contentHint = host.quality.hint;
  vtrack.addEventListener('ended', stopHost); // "Freigabe beenden" von Windows/Chromium
  $('preview').srcObject = host.stream;
  renderQuick();
  $('btnToTray').hidden = !native('trayShow');
  if (settings.codec === 'auto') await detectAutoCodec(vtrack);

  host.code = settings.fixedCode && settings.myCode ? settings.myCode : newCode();
  host.fixedTries = 0;
  host.codeNote = '';
  host.ready = false;
  await openHostPeers();
}

async function openHostPeers() {
  const id = peerIdFor(host.code);
  host.directError = '';
  if (settings.internetEnabled) addHostPeer(new Peer(id, internetOpts()), 'internet');
  if (settings.directEnabled && native('directStart')) {
    try {
      host.direct = await window.directStart();
      if (!host.stream) return; // inzwischen beendet
      addHostPeer(new Peer(id, directOpts('127.0.0.1', host.direct.port)), 'direct');
    } catch (e) {
      host.direct = null;
      host.directError = String(e);
    }
  }
  if (!host.peers.length) {
    stopHost();
    homeMessage(t('Direktverbindung nicht möglich: {e}', { e: host.directError || t('unbekannter Fehler') }));
  }
  renderHostStatus();
}

function addHostPeer(peer, kind) {
  peer.kind = kind;
  host.peers.push(peer);

  peer.on('open', () => {
    peer.isOpen = true;
    console.log('host: ' + kind + ' bereit, CODE ' + host.code);
    if (!host.ready) {
      host.ready = true;
      $('copyHint').textContent = t('Klicken zum Kopieren');
      $('copyHint').classList.remove('ok');
      show('host');
      updateTitle(t('{app} – teilt ({code})', { app: APP, code: host.code }));
      $('btnShare').disabled = false;
      const copied = settings.autoCopyCode ? copyCode() : Promise.resolve(false);
      if (native('hideCaptureNotice')) window.hideCaptureNotice(); // eigene Anzeige statt Chromium-Leiste
      copied.then((ok) => {
        if (settings.shareView === 'tray') toTray(ok);
        else {
          trayIcon(); // Symbol auch sonst – darüber kommen Meldungen, wenn das Fenster im Hintergrund ist
          // Erst ein paar Sekunden das ganze Fenster mit dem Code, dann zur Leiste
          if (settings.shareView === 'bar') startBarCountdown(5);
        }
      });
    }
    renderHostStatus();
  });

  peer.on('connection', (conn) => {
    conn.on('open', () => {
      const key = kind + ':' + conn.peer;
      const call = peer.call(conn.peer, host.stream, { sdpTransform: freeCodecsOnly });
      host.calls.set(key, { call, conn });
      tuneSender(call.peerConnection);
      updateViewerCount();
      const drop = (why) => {
        if (!host.calls.has(key)) return;
        console.log('host: viewer weg', key, why);
        host.calls.delete(key);
        call.close();
        conn.close();
        updateViewerCount();
      };
      console.log('host: viewer verbunden', key);
      conn.on('data', (d) => onViewerData(conn, d)); // extras.js: Reaktionen, Zeigen-Ping
      conn.on('close', () => drop('conn close'));
      call.on('close', () => drop('call close'));
      call.on('error', (e) => drop('call error ' + e));
    });
  });

  peer.on('disconnected', () => {
    // Verbindung zum Vermittlungsserver weg – bestehende Zuschauer laufen weiter.
    if (host.peers.includes(peer) && !peer.destroyed) setTimeout(() => peer.reconnect(), 2000);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id' && kind === 'internet') {
      destroyHostPeers();
      if (settings.fixedCode && host.code === settings.myCode && ++host.fixedTries <= 5) {
        // Fester Code noch belegt – meist hält der Server die letzte Sitzung noch ein paar Sekunden
        console.log('host: fester Code noch belegt, neuer Versuch', host.fixedTries);
        setTimeout(() => { if (host.stream) openHostPeers(); }, 2500);
        return;
      }
      if (settings.fixedCode && host.code === settings.myCode) host.codeNote = t('Dein fester Code ist gerade belegt – diesmal gilt ein anderer.');
      // Code zufällig schon vergeben -> neuer Code auf allen Wegen
      console.log('host: Code vergeben, neuer Code');
      host.code = newCode();
      openHostPeers();
    } else if (isNetError(err.type)) {
      peer.failed = true;
      console.warn('host: ' + kind + ' nicht erreichbar', err.type);
      if (!host.peers.some((p) => p.isOpen && !p.failed) && !host.ready) {
        stopHost();
        homeMessage(kind === 'internet'
          ? t('Keine Verbindung zum Vermittlungsserver. Internet prüfen – oder in den Einstellungen die Direktverbindung einschalten.')
          : t('Direktverbindung nicht möglich.'));
      }
      renderHostStatus();
    } else {
      console.warn('host peer error', err.type, err);
    }
  });
}

function renderHostStatus() {
  $('codeBox').textContent = host.code;
  $('btnCopyLink').hidden = !host.peers.some((p) => p.kind === 'internet' && !p.failed);
  const direct = host.peers.find((p) => p.kind === 'direct' && p.isOpen);
  const info = $('directInfo');
  if (direct && host.direct) {
    const port = host.direct.port === 47800 ? '' : ':' + host.direct.port;
    const addrs = host.direct.addresses.length ? host.direct.addresses : [t('(keine LAN-Adresse gefunden)')];
    info.innerHTML = t('Im selben Netz direkt: {a}', { a: addrs.map((a) => '<code>' + a + port + '</code>').join(t(' oder ')) });
    info.hidden = false;
  } else {
    info.hidden = true;
  }
  const warns = [];
  const inet = host.peers.find((p) => p.kind === 'internet');
  if (inet && inet.failed) warns.push(t('Über das Internet gerade nicht erreichbar – nur direkt im eigenen Netz.'));
  if (host.directError) warns.push(t('Direktverbindung nicht möglich: {e}', { e: host.directError }));
  if (host.codeNote) warns.push(host.codeNote);
  $('netWarn').textContent = warns.join(' ');
  $('netWarn').hidden = !warns.length;
}

// Kopiert den Code. Über Go klappt das auch, wenn das Fenster nicht im Vordergrund ist.
async function copyCode() {
  try {
    if (native('setClipboard')) await window.setClipboard(host.code);
    else await navigator.clipboard.writeText(host.code);
    $('copyHint').textContent = t('Kopiert!');
    $('copyHint').classList.add('ok');
    return true;
  } catch {
    $('copyHint').textContent = t('Kopieren nicht möglich');
    return false;
  }
}

// ---------- Infobereich ----------
function trayTip() {
  const n = host.calls.size;
  return t('{app} – du teilst ({code})', { app: APP, code: host.code }) + (n ? t(n === 1 ? ' · {n} schaut zu' : ' · {n} schauen zu', { n }) : '');
}

function toTray(copied) {
  if (!native('trayShow') || !host.stream) return;
  const text = t('Code: {code}', { code: host.code }) + (copied ? t(' (in der Zwischenablage)') : '') +
    '\n' + t('Klick aufs Symbol zeigt das Fenster, Rechtsklick für mehr.');
  window.trayShow(host.code, trayTip(), t('Du teilst deinen Bildschirm'), text, true).catch(() => {});
}

// Symbol im Infobereich ohne Fenster auszublenden und ohne Benachrichtigung
function trayIcon() {
  if (native('trayShow') && host.stream) window.trayShow(host.code, trayTip(), '', '', false).catch(() => {});
}

// ---------- Schnellauswahl (wirkt sofort auf alle Zuschauer) ----------
function renderQuick() {
  document.querySelectorAll('#qMode button').forEach((b) => b.classList.toggle('active', b.dataset.q === host.live.mode));
  $('qHeight').value = String(host.live.maxHeight);
  $('qBitrate').value = String(host.live.maxBitrate);
  // "Original" mit der echten Größe beschriften, z. B. "Original (3840×2160)"
  const [track] = host.stream ? host.stream.getVideoTracks() : [];
  const s = track ? track.getSettings() : {};
  const label = s.width ? t('Original') + ' (' + s.width + '×' + s.height + ')' : t('Original');
  for (const id of ['qHeight', 'fbHeight']) {
    const opt = $(id) && $(id).querySelector('option[value="0"]');
    if (opt) opt.textContent = label;
  }
  // "Automatisch" mit der aktuellen Obergrenze beschriften
  const outH = host.live.maxHeight > 0 ? Math.min(s.height || host.live.maxHeight, host.live.maxHeight) : s.height || 1080;
  const auto = t('Automatisch') + ' (' + t('bis {n} Mbit/s', { n: autoBitrate(outH, QUALITY[host.live.mode].fps) }) + ')';
  for (const id of ['qBitrate', 'fbBitrate']) {
    const opt = $(id) && $(id).querySelector('option[value="0"]');
    if (opt) opt.textContent = id === 'fbBitrate' ? t('Auto') + ' ' + autoBitrate(outH, QUALITY[host.live.mode].fps) : auto;
  }
}

// Obergrenze der Datenrate bei "Automatisch": wächst mit Auflösung und Bildrate.
// Ruhiges Bild braucht trotzdem kaum etwas – WebRTC schickt nur, was sich ändert.
function autoBitrate(height, fps) {
  const mp = (height * (16 / 9) * height) / 1e6;          // Megapixel (bei 16:9)
  const perMp = fps > 30 ? 5 : 3;                          // Mbit/s je Megapixel
  return Math.round(Math.min(60, Math.max(fps > 30 ? 12 : 8, mp * perMp)));
}

async function applySender(sender) {
  if (!sender.track || sender.track.kind !== 'video') return;
  const q = host.quality;
  const srcHeight = sender.track.getSettings().height || 0;
  const outHeight = host.live.maxHeight > 0 ? Math.min(srcHeight || host.live.maxHeight, host.live.maxHeight) : srcHeight || 1080;
  const p = sender.getParameters();
  if (!p.encodings || !p.encodings.length) p.encodings = [{}];
  const mbit = host.live.maxBitrate > 0 ? host.live.maxBitrate : autoBitrate(outHeight, q.fps);
  p.encodings[0].maxBitrate = mbit * 1_000_000;
  p.encodings[0].maxFramerate = q.fps;
  p.encodings[0].scaleResolutionDownBy = host.live.maxHeight > 0 && srcHeight > host.live.maxHeight
    ? srcHeight / host.live.maxHeight : 1;
  console.log('host: Datenrate max', mbit, 'Mbit/s bei', outHeight + 'p', q.fps, 'fps');
  p.degradationPreference = q.degradation;
  try { await sender.setParameters(p); } catch (e) { console.warn('setParameters', e); }
}

async function applyLive() {
  host.quality = QUALITY[host.live.mode];
  const [vtrack] = host.stream ? host.stream.getVideoTracks() : [];
  if (!vtrack) return;
  vtrack.contentHint = host.quality.hint;
  try { await vtrack.applyConstraints({ frameRate: { ideal: host.quality.fps, max: 60 } }); } catch { /* egal */ }
  for (const { call } of host.calls.values()) {
    for (const sender of call.peerConnection.getSenders()) await applySender(sender);
  }
  console.log('host: Schnellauswahl', JSON.stringify(host.live));
  renderQuick(); // Beschriftungen "Original (…)" und "Auto (bis … Mbit/s)" neu berechnen
  renderBar();
}

// Anderen Monitor bzw. anderes Fenster teilen – Zuschauer und Code bleiben.
async function switchSource() {
  if (!host.stream) return;
  let next;
  try {
    next = await captureScreen(host.quality);
  } catch (e) {
    if (e.name !== 'NotAllowedError') $('netWarn').textContent = t('Quelle wechseln nicht möglich: {e}', { e: e.message });
    return; // abgebrochen: alte Quelle läuft weiter
  }
  const old = host.stream;
  const [vtrack] = next.getVideoTracks();
  vtrack.contentHint = host.quality.hint;
  vtrack.addEventListener('ended', stopHost);
  for (const t of old.getVideoTracks()) t.removeEventListener('ended', stopHost);

  for (const { call } of host.calls.values()) {
    for (const sender of call.peerConnection.getSenders()) {
      const kind = sender.track ? sender.track.kind : null;
      if (kind === 'video') await sender.replaceTrack(vtrack);
      // Ton: neue Tonspur einsetzen oder stummschalten, wenn die neue Quelle keinen Ton hat
      else if (kind === 'audio' || (!kind && next.getAudioTracks().length)) await sender.replaceTrack(next.getAudioTracks()[0] || null);
    }
  }
  host.stream = next; // neue Zuschauer bekommen gleich die neue Quelle
  old.getTracks().forEach((t) => t.stop());
  $('preview').srcObject = next;
  await applyLive();
  console.log('host: Quelle gewechselt', vtrack.label);
  if (native('hideCaptureNotice')) window.hideCaptureNotice();
}

function tuneSender(pc) {
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState !== 'connected') return;
    pc.getSenders().forEach(applySender);
    setTimeout(() => showEncoder(pc), 3000);
  });
}

// Zeigt, ob die Grafikkarte kodiert (z. B. NVENC über MediaFoundation) oder die CPU.
async function showEncoder(pc) {
  const report = await pc.getStats();
  report.forEach((s) => {
    if (s.type !== 'outbound-rtp' || s.kind !== 'video') return;
    const hw = s.powerEfficientEncoder;
    const impl = s.encoderImplementation || '';
    let tip = '';
    if (hw === false) {
      tip = settings.gpu === 'auto'
        ? t(' – Tipp: Einstellungen › Grafikkarte auf „Leistungsstark“ stellen.')
        : t(' – Ein aktueller Grafiktreiber kann helfen.');
    }
    $('encInfo').textContent =
      (hw === true ? t('Hardware-Encoding aktiv') : hw === false ? t('Software-Encoding (CPU)') : 'Encoder') +
      (impl ? ' · ' + impl : '') + tip;
  });
}

const viewerName = (conn) => ((conn.metadata && conn.metadata.name) || '').trim();

function updateViewerCount() {
  const n = host.calls.size;
  const names = [...host.calls.values()].map((e) => viewerName(e.conn)).filter(Boolean);
  $('viewerCount').textContent =
    n === 0 ? t('Noch niemand schaut zu.')
      : n === 1 ? t('{name} schaut zu.', { name: names[0] || t('1 Person') })
        : t('{n} Personen schauen zu', { n }) + (names.length ? ': ' + names.join(', ') : '.');
  // Tooltip des Symbols aktualisieren, bei neuen Zuschauern kurz melden (Leiste, Fenster oder Windows)
  if (native('trayUpdate')) window.trayUpdate(trayTip(), '', '').catch(() => {});
  if (n > (host.lastCount || 0)) {
    const newest = viewerName([...host.calls.values()].pop().conn);
    notifyHost(t('{name} schaut jetzt zu', { name: newest || t('Jemand') }), $('viewerCount').textContent);
  }
  host.lastCount = n;
  renderBar();
}

function destroyHostPeers() {
  const peers = host.peers;
  host.peers = [];
  peers.forEach((p) => p.destroy());
}

function stopHost() {
  if (fbar.active) leaveBar('home');
  for (const { call, conn } of host.calls.values()) { call.close(); conn.close(); }
  host.calls.clear();
  host.lastCount = 0;
  destroyHostPeers();
  if (native('trayHide')) window.trayHide().catch(() => {});
  if (native('directStop')) window.directStop().catch(() => {});
  host.direct = null;
  if (host.stream) { host.stream.getTracks().forEach((t) => t.stop()); host.stream = null; }
  $('preview').srcObject = null;
  $('encInfo').textContent = '';
  $('btnShare').disabled = false;
  updateTitle(APP);
  show('home');
}

// ---------- Zuschauen (Viewer) ----------
const viewer = { peer: null, call: null, conn: null, statsTimer: 0, connectTimer: 0, last: null, way: 'code' };

function setWay(way) {
  viewer.way = way;
  document.querySelectorAll('#waySeg button').forEach((b) => {
    const on = b.dataset.way === way;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $('addrField').hidden = way !== 'direct';
  $('wayHint').textContent = way === 'direct'
    ? t('Nur im selben Netz (WLAN/LAN). Die IP-Adresse steht beim Teilen unter dem Code.')
    : t('Klappt überall mit Internet.');
  storeSet('way', way);
}

function startViewer() {
  homeMessage('');
  const code = normalizeCode($('codeInput').value);
  if (!code) { homeMessage(t('Der Code hat 6 Zeichen, z. B. ABC-123.')); return; }

  let opts = internetOpts();
  let target = code;
  if (viewer.way === 'direct') {
    const addr = parseAddress($('addrInput').value);
    if (!addr) { homeMessage(t('Bitte die IP-Adresse eingeben, z. B. 192.168.1.20.')); return; }
    opts = directOpts(addr.host, addr.port);
    target = addr.host + (addr.port === 47800 ? '' : ':' + addr.port);
    storeSet('lastAddr', $('addrInput').value.trim());
  }

  $('btnWatch').disabled = true;
  $('waiting').textContent = t('Verbinde mit {t} …', { t: target });
  $('waiting').hidden = false;
  $('stats').textContent = '';

  const peer = new Peer(opts);
  viewer.peer = peer;
  viewer.call = null;

  peer.on('open', () => {
    const name = $('nameInput').value.trim().slice(0, 24);
    storeSet('viewerName', name);
    const conn = peer.connect(peerIdFor(code), { reliable: true, metadata: { name } });
    viewer.conn = conn;
    conn.on('close', () => endViewer(t('Die Freigabe wurde beendet.')));
    show('viewer');
    updateTitle(t('{app} – schaut {code}', { app: APP, code }));
    viewer.connectTimer = setTimeout(() => {
      if (!viewer.call) endViewer(t('Keine Verbindung möglich. Evtl. blockiert eine Firewall oder das Netz (CGNAT) – ein Relay-Server (TURN) in den Einstellungen kann helfen.'));
    }, 20000);
  });

  peer.on('call', (call) => {
    viewer.call = call;
    call.answer(undefined, { sdpTransform: (sdp) => freeCodecsOnly(sdp, false) });
    call.on('stream', (stream) => {
      console.log('viewer: stream erhalten');
      clearTimeout(viewer.connectTimer);
      $('remote').srcObject = stream;
      // Ohne Klick (Auto-Verbinden von der Webseite) blockiert der Browser Ton: dann stumm starten
      $('remote').play().catch(() => { $('remote').muted = true; $('remote').play().catch(() => {}); refreshTexts(); });
      $('waiting').hidden = true;
      startStats(call.peerConnection);
      viewerConnected(call.peerConnection); // extras.js: Zoom zurücksetzen, Ampel starten
    });
    call.on('close', () => endViewer(t('Die Freigabe wurde beendet.')));
    call.peerConnection.addEventListener('connectionstatechange', () => {
      if (call.peerConnection.connectionState === 'failed') endViewer(t('Verbindung abgebrochen.'));
    });
  });

  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') endViewer(t('Code nicht gefunden. Tippfehler oder Freigabe schon beendet?'));
    else if (isNetError(err.type) || /Could not get an ID/.test(err.message)) {
      endViewer(viewer.way === 'direct'
        ? t('Keine Verbindung zu {t}. Läuft dort Glotzofon mit eingeschalteter Direktverbindung, und hat die Firewall sie erlaubt?', { t: target })
        : t('Keine Verbindung zum Vermittlungsserver. Internet prüfen.'));
    } else console.warn('viewer peer error', err.type, err);
  });
}

function startStats(pc) {
  viewer.last = null;
  clearInterval(viewer.statsTimer);
  viewer.statsTimer = setInterval(async () => {
    const report = await pc.getStats();
    let inbound;
    const codecs = new Map();
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
      if (s.type === 'codec') codecs.set(s.id, s.mimeType);
    });
    if (!inbound) return;
    let mbps = 0;
    if (viewer.last) {
      const dt = (inbound.timestamp - viewer.last.timestamp) / 1000;
      mbps = ((inbound.bytesReceived - viewer.last.bytesReceived) * 8) / dt / 1e6;
    }
    viewer.last = inbound;
    const codec = (codecs.get(inbound.codecId) || '').replace('video/', '');
    $('stats').textContent =
      `${inbound.frameWidth || '?'}×${inbound.frameHeight || '?'} · ` +
      `${Math.round(inbound.framesPerSecond || 0)} fps · ${mbps.toFixed(1)} Mbit/s · ${codec}`;
  }, 1000);
}

function endViewer(message) {
  if (!viewer.peer) return;
  console.log('viewer: ende -', message);
  clearTimeout(viewer.connectTimer);
  clearInterval(viewer.statsTimer);
  const p = viewer.peer;
  viewer.peer = null;
  if (viewer.call) { viewer.call.close(); viewer.call = null; }
  viewer.conn = null;
  viewerDisconnected(); // extras.js
  p.destroy();
  $('remote').srcObject = null;
  $('btnWatch').disabled = false;
  if (document.fullscreenElement || isFull) toggleFullscreen(false);
  updateTitle(APP);
  show('home');
  homeMessage(message || '');
}

// ---------- Vollbild ----------
// Echtes Vollbild über das native Fenster (Go-Binding), sonst Browser-Vollbild.
let isFull = false;
function toggleFullscreen(force) {
  const want = typeof force === 'boolean' ? force : !isFull;
  if (want === isFull) return;
  isFull = want;
  if (native('setFullscreen')) window.setFullscreen(want).catch(() => {});
  else if (want) document.documentElement.requestFullscreen().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen();
  $('btnFull').textContent = want ? t('Fenster') : t('Vollbild');
}

// ---------- Design ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = t;
  if (native('setDarkTitlebar')) window.setDarkTitlebar(t === 'dark').catch(() => {});
}
darkQuery.addEventListener('change', applyTheme);

// ---------- Einstellungen ----------
async function persistSettings() {
  const hint = $('savedHint');
  if (!native('saveSettings')) { // Web-Modus: im Browser speichern
    storeSet('settings', JSON.stringify(settings));
    hint.textContent = t('Gespeichert');
    hint.hidden = false;
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => { hint.hidden = true; }, 1500);
    return;
  }
  try {
    await window.saveSettings(settings);
    hint.textContent = t('Gespeichert');
    hint.classList.remove('err');
  } catch (e) {
    console.warn('saveSettings', e);
    hint.textContent = t('Speichern fehlgeschlagen: {e}', { e });
    hint.classList.add('err');
  }
  hint.hidden = false;
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => { hint.hidden = true; }, hint.classList.contains('err') ? 6000 : 1500);
}

function fillSettingsForm() {
  const s = settings;
  $('sQuality').value = s.quality;
  $('sMaxHeight').value = String(s.maxHeight);
  $('sMaxBitrate').value = String(s.maxBitrate);
  $('sShareAudio').checked = s.shareAudio;
  $('sAutoCopy').checked = s.autoCopyCode;
  $('sFixed').checked = s.fixedCode;
  $('myCodeView').textContent = s.myCode;
  $('fixedRow').hidden = !s.fixedCode;
  $('sInternet').checked = s.internetEnabled;
  $('sDirect').checked = s.directEnabled;
  $('sDirectPort').value = s.directPort;
  $(s.server.custom ? 'sServerCustom' : 'sServerPublic').checked = true;
  $('sHost').value = s.server.host;
  $('sPort').value = s.server.port;
  $('sPath').value = s.server.path;
  $('sKey').value = s.server.key;
  $('sSecure').checked = s.server.secure;
  $('sTurnUrl').value = s.turn.url;
  $('sTurnUser').value = s.turn.username;
  $('sTurnPass').value = s.turn.credential;
  $('sTheme').value = s.theme;
  $('sLang').value = s.lang;
  $('sCodec').value = s.codec;
  $('sShareView').value = s.shareView;
  $('sGpu').value = s.gpu;
  $('gpuRestartRow').hidden = s.gpu === startGpu;
  $('sUpdate').value = s.updateCheck;
  $('customServer').hidden = !s.server.custom;
  $('directPortRow').hidden = !s.directEnabled;
}

function readSettingsForm(changed) {
  const s = settings;
  s.quality = $('sQuality').value;
  s.maxHeight = Number($('sMaxHeight').value);
  s.maxBitrate = Number($('sMaxBitrate').value);
  s.shareAudio = $('sShareAudio').checked;
  s.autoCopyCode = $('sAutoCopy').checked;
  // mindestens ein Verbindungsweg
  if (!$('sInternet').checked && !$('sDirect').checked) {
    changed.checked = true;
    $('waysMsg').textContent = t('Mindestens ein Weg muss an bleiben.');
  } else {
    $('waysMsg').textContent = '';
  }
  s.fixedCode = $('sFixed').checked;
  if (s.fixedCode && !s.myCode) s.myCode = newCode();
  $('myCodeView').textContent = s.myCode;
  $('fixedRow').hidden = !s.fixedCode;
  s.internetEnabled = $('sInternet').checked;
  s.directEnabled = $('sDirect').checked;
  const port = Number($('sDirectPort').value);
  s.directPort = port >= 1024 && port <= 65535 ? port : 47800;
  s.server = {
    custom: $('sServerCustom').checked,
    host: $('sHost').value.trim(),
    port: Number($('sPort').value) || 443,
    path: $('sPath').value.trim() || '/',
    secure: $('sSecure').checked,
    key: $('sKey').value.trim() || 'peerjs',
  };
  s.turn = { url: $('sTurnUrl').value.trim(), username: $('sTurnUser').value.trim(), credential: $('sTurnPass').value };
  s.theme = $('sTheme').value;
  if (s.lang !== $('sLang').value) { s.lang = $('sLang').value; setLanguage(s.lang); refreshTexts(); }
  s.codec = $('sCodec').value;
  s.shareView = $('sShareView').value;
  s.gpu = $('sGpu').value;
  $('gpuRestartRow').hidden = s.gpu === startGpu;
  s.updateCheck = $('sUpdate').value;
  $('customServer').hidden = !s.server.custom;
  $('directPortRow').hidden = !s.directEnabled;
  $('quality').value = s.quality;
  applyTheme();
}

$('settings').addEventListener('change', (e) => {
  readSettingsForm(e.target);
  persistSettings();
});

// ---------- Updates ----------
const upd = { info: null, installing: false, installed: '' };

window.onUpdateInfo = (info) => {
  upd.info = info;
  console.log('update:', JSON.stringify(info));
  renderUpdate();
};

window.onUpdateProgress = (pct) => {
  for (const id of ['bannerProgress', 'updProgress']) {
    $(id).hidden = false;
    $(id).firstElementChild.style.width = pct + '%';
  }
  $('bannerSub').textContent = t('Lade herunter … {p} %', { p: pct });
  $('updStatus').textContent = t('Lade herunter … {p} %', { p: pct });
};

window.onUpdateDone = (res) => {
  upd.installing = false;
  ['bannerProgress', 'updProgress'].forEach((id) => { $(id).hidden = true; });
  if (res.error) {
    upd.error = t('Update nicht möglich: {e}', { e: t(res.error) });
  } else {
    upd.installed = res.version;
    upd.error = '';
  }
  renderUpdate();
};

function renderUpdate() {
  const i = upd.info;
  const banner = $('updateBanner');
  const newer = i && i.newer;
  let status;
  if (upd.installed) status = t('Version {v} ist installiert. Neu starten, um sie zu nutzen.', { v: upd.installed });
  else if (upd.installing) status = t('Lade herunter …');
  else if (upd.error) status = upd.error;
  else if (!i) status = t('Version {v}', { v: appInfoCache.version || '?' });
  else if (newer) status = t('Version {v} ist verfügbar (du hast {c}).', { v: i.latest, c: i.current });
  else if (i.error) status = t(i.error);
  else status = t('Du hast die neueste Version ({c}).', { c: i.current });
  $('updStatus').textContent = status;

  const showInstall = !!upd.installed || (newer && !upd.installing);
  for (const id of ['updInstall', 'bannerInstall']) {
    $(id).hidden = !showInstall;
    $(id).disabled = upd.installing;
    $(id).textContent = upd.installed ? t('Neu starten') : t('Jetzt aktualisieren');
  }

  const dismissed = storeGet('dismissedVersion');
  banner.hidden = !(upd.installed || upd.installing || (newer && dismissed !== i.latest));
  $('bannerTitle').textContent = upd.installed
    ? t('Update installiert')
    : newer ? t('Version {v} ist verfügbar', { v: i.latest }) : t('Update');
  if (!upd.installing) $('bannerSub').textContent = upd.installed ? t('Neu starten, um sie zu nutzen.') : upd.error || t('Du hast {c}.', { c: i ? i.current : '' });
  $('bannerNotes').hidden = !!upd.installed;
}

function installOrRestart() {
  if (upd.installed) {
    if ((host.stream || viewer.peer) && !confirm(t('Die laufende Freigabe wird beendet. Jetzt neu starten?'))) return;
    window.restartApp().catch((e) => { upd.error = t('Neustart nicht möglich: {e}', { e }); renderUpdate(); });
    return;
  }
  if (!native('installUpdate')) return;
  upd.installing = true;
  upd.error = '';
  renderUpdate();
  window.installUpdate();
}

function checkUpdates(force) {
  if (!native('checkUpdate')) return;
  if (force) { upd.error = ''; $('updStatus').textContent = t('Suche nach Updates …'); }
  window.checkUpdate(force);
}

$('bannerInstall').addEventListener('click', installOrRestart);
$('updInstall').addEventListener('click', installOrRestart);
$('bannerNotes').addEventListener('click', () => openLink((upd.info && upd.info.url) || GITHUB + '/releases/latest'));
$('updPage').addEventListener('click', () => openLink((upd.info && upd.info.url) || GITHUB + '/releases/latest'));
$('bannerClose').addEventListener('click', () => {
  if (upd.info && upd.info.latest) storeSet('dismissedVersion', upd.info.latest);
  $('updateBanner').hidden = true;
});
$('updCheck').addEventListener('click', () => checkUpdates(true));

// ---------- Info ----------
let appInfoCache = {};

const CREDITS = [
  ['PeerJS', 'Verbindungsaufbau über WebRTC – MIT-Lizenz', 'https://github.com/peers/peerjs'],
  ['PeerJS-Server (0.peerjs.com)', 'Öffentlicher Vermittlungsserver des PeerJS-Projekts', 'https://peerjs.com'],
  ['go-webview2', '© John Chadwick – MIT-Lizenz', 'https://github.com/jchv/go-webview2'],
  ['coder/websocket', '© Coder – ISC-Lizenz (eingebauter Server der Direktverbindung)', 'https://github.com/coder/websocket'],
  ['Go & golang.org/x/sys', '© The Go Authors – BSD-Lizenz', 'https://go.dev'],
  ['Microsoft Edge WebView2 SDK', '© Microsoft – BSD-Lizenz (WebView2Loader, in der EXE enthalten)', 'https://www.nuget.org/packages/Microsoft.Web.WebView2'],
  ['Microsoft Edge WebView2 Runtime', '© Microsoft – Teil von Windows (Oberfläche, Bildschirmaufnahme, Video)', 'https://developer.microsoft.com/microsoft-edge/webview2/'],
  ['go-winloader', '© John Chadwick – ISC-Lizenz', 'https://github.com/jchv/go-winloader'],
];

function openLink(url) {
  if (native('openUrl')) window.openUrl(url).catch(() => {});
  else window.open(url, '_blank');
}

async function loadInfo() {
  if (!native('appInfo')) { $('infoVersion').textContent = t('Zuschauen im Browser'); return; }
  appInfoCache = await window.appInfo();
  renderInfo();
}

function renderInfo() {
  const i = appInfoCache;
  $('infoVersion').textContent = t('Version {v}', { v: i.version });
  $('infoDate').textContent = i.buildDate ? t(' · Stand {d}', { d: i.buildDate }) : '';
  $('configDir').textContent = i.configDir;
  $('modeTitle').textContent = i.portable ? t('Portabler Modus ist aktiv') : t('So speichert die App');
  $('modeText').textContent = i.portable
    ? t('Neben der EXE liegt eine Datei portable.txt. Deshalb speichert die App ihre Einstellungen neben sich – praktisch auf einem USB-Stick.')
    : t('Die Einstellungen gehören zu deinem Windows-Konto (AppData). Neben der EXE wird nichts angelegt.');
  $('switchMode').textContent = i.portable ? t('Einstellungen auf diesem PC speichern') : t('Einstellungen neben der App speichern (portabel)');
  if (!upd.info) renderUpdate();
}

$('switchMode').addEventListener('click', async () => {
  const toPortable = !appInfoCache.portable;
  try {
    appInfoCache = await window.setPortable(toPortable);
    $('modeMsg').className = 'msg small ok';
    $('modeMsg').textContent = toPortable ? t('Umgestellt: Einstellungen liegen jetzt neben der App.') : t('Umgestellt: Einstellungen liegen jetzt auf diesem PC.');
  } catch (e) {
    $('modeMsg').className = 'msg small';
    $('modeMsg').textContent = t('Umstellen nicht möglich: {e}', { e });
  }
  renderInfo();
});
$('openConfig').addEventListener('click', () => window.openConfigFolder && window.openConfigFolder().catch(() => {}));
$('linkGithub').addEventListener('click', (e) => { e.preventDefault(); openLink(GITHUB); });
$('linkIssues').addEventListener('click', (e) => { e.preventDefault(); openLink(GITHUB + '/issues'); });

$('credits').innerHTML = CREDITS.map(([name, detail, url]) =>
  `<li><a href="#" data-url="${url}">${name}</a><span class="muted">${t(detail)}</span></li>`).join('');
$('credits').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (a) { e.preventDefault(); openLink(a.dataset.url); }
});
$('licenses').addEventListener('toggle', async () => {
  if (!$('licenses').open || $('licenseText').dataset.loaded) return;
  try {
    $('licenseText').textContent = await (await fetch('licenses.txt')).text();
    $('licenseText').dataset.loaded = '1';
  } catch { $('licenseText').textContent = t('Lizenztexte nicht gefunden.'); }
});

// ---------- UI ----------
// "Zurück" bzw. Logo: während einer Freigabe zurück zur Freigabe, sonst zur Startseite.
function goHome() {
  if (host.stream && host.ready) { show('host'); return; }
  show('home');
  $('codeInput').focus();
}

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  const to = b.dataset.go;
  if (to === 'home') { goHome(); return; }
  if (to === 'settings') fillSettingsForm();
  if (to === 'info') loadInfo();
  show(to);
}));
document.querySelectorAll('#waySeg button').forEach((b) => b.addEventListener('click', () => setWay(b.dataset.way)));

// Schnellauswahl beim Teilen
document.querySelectorAll('#qMode button').forEach((b) => b.addEventListener('click', () => {
  host.live.mode = b.dataset.q;
  renderQuick();
  applyLive();
}));
$('qHeight').addEventListener('change', () => { host.live.maxHeight = Number($('qHeight').value); applyLive(); });
$('qBitrate').addEventListener('change', () => { host.live.maxBitrate = Number($('qBitrate').value); applyLive(); });
$('btnToTray').addEventListener('click', () => toTray(false));
$('btnSource').addEventListener('click', switchSource);

$('btnShare').addEventListener('click', startHost);
$('btnStop').addEventListener('click', stopHost);
$('btnWatch').addEventListener('click', startViewer);
$('quality').addEventListener('change', () => {
  settings.quality = $('quality').value;
  persistSettings();
});
for (const id of ['codeInput', 'addrInput', 'nameInput']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') startViewer(); });
}
$('codeInput').addEventListener('input', (e) => {
  const s = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  e.target.value = s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s;
});
$('codeBox').addEventListener('click', copyCode);
$('btnLeave').addEventListener('click', () => endViewer(''));
$('btnFull').addEventListener('click', () => toggleFullscreen());
$('btnMute').addEventListener('click', () => {
  const v = $('remote');
  v.muted = !v.muted;
  $('btnMute').textContent = v.muted ? t('Ton: aus') : t('Ton: an');
});
// WebView2 schluckt das keydown von Escape – daher auf keyup reagieren.
document.addEventListener('keyup', (e) => {
  if (e.key !== 'Escape') return;
  if (isFull) toggleFullscreen(false);
  else if ($('settings').classList.contains('active') || $('info').classList.contains('active')) goHome();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11' && $('viewer').classList.contains('active')) { e.preventDefault(); toggleFullscreen(); }
});

$('gpuRestart').addEventListener('click', async () => {
  if ((host.stream || viewer.peer) && !confirm(t('Die laufende Verbindung wird beendet. Jetzt neu starten?'))) return;
  await persistSettings();
  if (native('restartApp')) window.restartApp().catch(() => {});
});

$('newMyCode').addEventListener('click', () => {
  settings.myCode = newCode();
  $('myCodeView').textContent = settings.myCode;
  persistSettings();
});

// Link fürs Zuschauen im Browser (GitHub Pages) – nur über Code/Internet möglich
$('btnCopyLink').addEventListener('click', async () => {
  const link = WEB_VIEWER + '#' + host.code;
  try {
    if (native('setClipboard')) await window.setClipboard(link);
    else await navigator.clipboard.writeText(link);
    $('copyHint').textContent = t('Link kopiert!');
    $('copyHint').classList.add('ok');
  } catch { $('copyHint').textContent = t('Kopieren nicht möglich'); }
});
document.querySelectorAll('.dl-link').forEach((a) => { a.href = DOWNLOAD; });

// Nach einem Sprachwechsel die Texte neu setzen, die JavaScript selbst erzeugt
function refreshTexts() {
  setWay(viewer.way);
  renderUpdate();
  if (appInfoCache.version) renderInfo();
  if (host.stream) { updateViewerCount(); renderHostStatus(); }
  $('btnMute').textContent = $('remote').muted ? t('Ton: aus') : t('Ton: an');
  $('btnFull').textContent = isFull ? t('Fenster') : t('Vollbild');
  document.querySelectorAll('#credits .muted').forEach((el, i) => { el.textContent = t(CREDITS[i][1]); });
}

// ---------- Start ----------
const ready = (async () => {
  if (native('getSettings')) {
    try { settings = Object.assign(structuredClone(DEFAULTS), await window.getSettings()); } catch (e) { console.warn('getSettings', e); }
  } else {
    // Web-Modus (Zuschauen im Browser): keine App dahinter
    document.body.classList.add('web');
    try { settings = Object.assign(structuredClone(DEFAULTS), JSON.parse(storeGet('settings') || '{}')); } catch { /* Standardwerte */ }
    settings.directEnabled = false;
    const m = /^#?([A-Za-z0-9]{3})-?([A-Za-z0-9]{3})$/.exec(location.hash);
    if (m) $('codeInput').value = (m[1] + '-' + m[2]).toUpperCase();
  }
  startGpu = settings.gpu;
  setLanguage(settings.lang);
  applyTheme();
  $('quality').value = settings.quality;
  setWay(storeGet('way') === 'direct' && !document.body.classList.contains('web') ? 'direct' : 'code');
  $('addrInput').value = storeGet('lastAddr') || '';
  $('nameInput').value = storeGet('viewerName') || '';
  await loadInfo();
  checkUpdates(false);
  // Code schon da (Link aus dem Browser)? Dann direkt auf "Verbinden"
  if (normalizeCode($('codeInput').value)) {
    $('btnWatch').focus();
    // Von der Webseite mit "Verbinden" hergekommen: gleich verbinden
    let go = false;
    try { go = sessionStorage.getItem('glotzofon.go') === '1'; sessionStorage.removeItem('glotzofon.go'); } catch { /* egal */ }
    if (go && document.body.classList.contains('web')) $('btnWatch').click();
  }
  else $('codeInput').focus();
})();
