'use strict';
// Extras rund ums Zuschauen: Zoom & Verschieben, Verbindungsampel, Reaktionen, Zeigen-Ping, Meldungen.
// Nachrichten zwischen Zuschauer und Teilendem laufen über die PeerJS-Datenverbindung (conn):
//   { t: 'react', r: '👍' }          Reaktion (nur Werte aus der festen Liste)
//   { t: 'ping', x: 0.42, y: 0.17 }  Zeigen-Ping, Position relativ zum Bild (0..1)

// ---------- Meldungen ----------
function toast(text, ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), ms);
  while ($('toasts').children.length > 4) $('toasts').firstElementChild.remove();
}

// ---------- Bedienelemente beim Zuschauen nur bei Bewegung zeigen ----------
const UI_IDLE_MS = 2500;
let uiTimer = 0;

function wakeViewerUI() {
  const v = $('viewer');
  v.classList.add('ui-on');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(function idle() {
    // Solange die Maus auf Leiste oder Reaktionen steht, sichtbar lassen
    if (v.querySelector('.bar:hover, .reactions:hover')) { uiTimer = setTimeout(idle, UI_IDLE_MS); return; }
    v.classList.remove('ui-on');
  }, UI_IDLE_MS);
}

for (const ev of ['mousemove', 'mousedown', 'wheel', 'touchstart']) {
  $('viewer').addEventListener(ev, wakeViewerUI, { passive: true });
}
$('viewer').addEventListener('mouseleave', () => { clearTimeout(uiTimer); $('viewer').classList.remove('ui-on'); });
document.addEventListener('keydown', () => { if ($('viewer').classList.contains('active')) wakeViewerUI(); });

// ---------- Zoom & Verschieben (Zuschauer) ----------
const zoom = { s: 1, x: 0, y: 0, drag: null };
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

function applyZoom() {
  const st = $('stage').getBoundingClientRect();
  // Bild darf nicht aus dem Fenster geschoben werden
  zoom.x = Math.min(0, Math.max(st.width - st.width * zoom.s, zoom.x));
  zoom.y = Math.min(0, Math.max(st.height - st.height * zoom.s, zoom.y));
  $('remote').style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  $('zoomReset').textContent = Math.round(zoom.s * 100) + ' %';
  $('stage').classList.toggle('zoomed', zoom.s > 1);
}

// Zoomt so, dass der Punkt (cx, cy) unter der Maus stehen bleibt.
function zoomAt(factor, cx, cy) {
  const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.s * factor));
  zoom.x = cx - (cx - zoom.x) * (s / zoom.s);
  zoom.y = cy - (cy - zoom.y) * (s / zoom.s);
  zoom.s = s;
  applyZoom();
}

function zoomCenter(factor) {
  const st = $('stage').getBoundingClientRect();
  zoomAt(factor, st.width / 2, st.height / 2);
}

function zoomReset() {
  zoom.s = 1; zoom.x = 0; zoom.y = 0;
  applyZoom();
}

$('stage').addEventListener('wheel', (e) => {
  e.preventDefault();
  const st = $('stage').getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - st.left, e.clientY - st.top);
}, { passive: false });

$('stage').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (pingMode) { sendPing(e.clientX, e.clientY); setPingMode(false); return; }
  if (zoom.s <= 1) return;
  zoom.drag = { px: e.clientX, py: e.clientY, x: zoom.x, y: zoom.y };
  $('stage').setPointerCapture(e.pointerId);
  $('stage').classList.add('dragging');
});
$('stage').addEventListener('pointermove', (e) => {
  if (!zoom.drag) return;
  zoom.x = zoom.drag.x + (e.clientX - zoom.drag.px);
  zoom.y = zoom.drag.y + (e.clientY - zoom.drag.py);
  applyZoom();
});
const endDrag = () => { zoom.drag = null; $('stage').classList.remove('dragging'); };
$('stage').addEventListener('pointerup', endDrag);
$('stage').addEventListener('pointercancel', endDrag);
$('stage').addEventListener('dblclick', () => toggleFullscreen());
window.addEventListener('resize', () => { if ($('viewer').classList.contains('active')) applyZoom(); });

$('zoomIn').addEventListener('click', () => zoomCenter(1.25));
$('zoomOut').addEventListener('click', () => zoomCenter(1 / 1.25));
$('zoomReset').addEventListener('click', zoomReset);
document.addEventListener('keydown', (e) => {
  if (!$('viewer').classList.contains('active') || e.ctrlKey || e.altKey) return;
  if (e.key === '+') zoomCenter(1.25);
  else if (e.key === '-') zoomCenter(1 / 1.25);
  else if (e.key === '0') zoomReset();
});

// ---------- Zeigen-Ping ----------
let pingMode = false;
let lastPingSent = 0;

function setPingMode(on) {
  pingMode = on;
  $('btnPing').classList.toggle('active', on);
  $('stage').classList.toggle('pinging', on);
}

// Bildschirmposition -> Position im Bild (0..1), berücksichtigt Zoom und schwarze Ränder.
function contentPoint(clientX, clientY) {
  const v = $('remote');
  if (!v.videoWidth) return null;
  const r = v.getBoundingClientRect();
  const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const w = v.videoWidth * k;
  const h = v.videoHeight * k;
  const x = (clientX - r.left - (r.width - w) / 2) / w;
  const y = (clientY - r.top - (r.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function showPingMark(container, left, top) {
  const m = document.createElement('span');
  m.className = 'ping-mark';
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  container.append(m);
  setTimeout(() => m.remove(), 1500);
}

function sendPing(clientX, clientY) {
  const p = contentPoint(clientX, clientY);
  if (!p || !viewer.conn || Date.now() - lastPingSent < 400) return;
  lastPingSent = Date.now();
  viewer.conn.send({ t: 'ping', x: p.x, y: p.y });
  const vr = $('viewer').getBoundingClientRect();
  showPingMark($('viewer'), clientX - vr.left, clientY - vr.top);
}

$('stage').addEventListener('contextmenu', (e) => { e.preventDefault(); sendPing(e.clientX, e.clientY); });
$('btnPing').addEventListener('click', () => setPingMode(!pingMode));

// ---------- Reaktionen ----------
const REACTIONS = [...document.querySelectorAll('.react')].map((b) => b.dataset.r);

document.querySelectorAll('.react').forEach((b) => b.addEventListener('click', () => {
  if (!viewer.conn) return;
  viewer.conn.send({ t: 'react', r: b.dataset.r });
  b.classList.add('sent');
  setTimeout(() => b.classList.remove('sent'), 600);
}));

// Teilender: Nachricht eines Zuschauers auswerten.
const lastFrom = new WeakMap(); // Bremse gegen Dauerfeuer je Zuschauer und Nachrichtentyp
function onViewerData(conn, d) {
  if (!d || typeof d !== 'object') return;
  const now = Date.now();
  const times = lastFrom.get(conn) || {};
  if (now - (times[d.t] || 0) < 250) return;
  times[d.t] = now;
  lastFrom.set(conn, times);
  const who = viewerName(conn) || t('Jemand');
  console.log('host: Nachricht', JSON.stringify(d));

  if (d.t === 'react' && REACTIONS.includes(d.r)) {
    notifyHost(who + ': ' + t(d.r), '', t('Reaktion'));
  } else if (d.t === 'ping' && Number.isFinite(d.x) && Number.isFinite(d.y)) {
    const x = Math.min(1, Math.max(0, d.x));
    const y = Math.min(1, Math.max(0, d.y));
    // Vorschau im Fenster
    const pv = $('preview');
    const r = pv.getBoundingClientRect();
    if (pv.videoWidth && r.width) {
      const k = Math.min(r.width / pv.videoWidth, r.height / pv.videoHeight);
      const w = pv.videoWidth * k;
      const h = pv.videoHeight * k;
      showPingMark(pv.parentElement, (r.width - w) / 2 + x * w, (r.height - h) / 2 + y * h);
    }
    // Auf dem echten Bildschirm (Go zeichnet einen Kreis über dem geteilten Monitor/Fenster)
    const [track] = host.stream ? host.stream.getVideoTracks() : [];
    if (track && native('showPing')) window.showPing(track.label, x, y).catch(() => {});
    notifyHost(t('{who} zeigt auf etwas', { who }), '', '', true);
  }
}

// Meldung beim Teilenden: in der schwebenden Leiste, sonst im Fenster – und wenn das Fenster
// nicht im Vordergrund ist, als Windows-Benachrichtigung über das Symbol im Infobereich.
// quiet: keine Windows-Benachrichtigung (z. B. beim Ping, der ist ohnehin auf dem Bildschirm).
async function notifyHost(text, detail = '', title = '', quiet = false) {
  if (barMessage(text)) return;
  const active = native('windowActive') ? await window.windowActive() : true;
  if (active || quiet || !native('trayUpdate')) { toast(text); return; }
  window.trayUpdate(trayTip(), title || text, detail || text).catch(() => {});
}

// ---------- Verbindungsampel ----------
// gut: Ping < 120 ms und < 1 % Verlust · mittel: < 300 ms und < 5 % · sonst schlecht
function grade(rtt, loss) {
  if (rtt == null) return '';
  if (rtt < 120 && loss < 1) return 'good';
  if (rtt < 300 && loss < 5) return 'mid';
  return 'bad';
}
const GRADE_TEXT = { good: 'Gute Verbindung', mid: 'Mittelmäßige Verbindung', bad: 'Schlechte Verbindung' }; // über t() übersetzt

let signalTimer = 0;
let signalLast = null;

function viewerConnected(pc) {
  wakeViewerUI(); // kurz zeigen, was es gibt
  zoomReset();
  setPingMode(false);
  signalLast = null;
  clearInterval(signalTimer);
  signalTimer = setInterval(() => updateViewerSignal(pc), 2000);
}

function viewerDisconnected() {
  clearInterval(signalTimer);
  $('signal').hidden = true;
  setPingMode(false);
  zoomReset();
}

async function updateViewerSignal(pc) {
  const r = await pc.getStats();
  let pair = null;
  let inbound = null;
  r.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = r.get(s.selectedCandidatePairId);
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
  });
  if (!pair) r.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
  if (!pair || !inbound) return;

  const rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
  let loss = 0;
  if (signalLast) {
    const lost = inbound.packetsLost - signalLast.packetsLost;
    const got = inbound.packetsReceived - signalLast.packetsReceived;
    loss = lost + got > 0 ? (Math.max(0, lost) / (lost + got)) * 100 : 0;
  }
  signalLast = inbound;

  const lc = r.get(pair.localCandidateId);
  const rc = r.get(pair.remoteCandidateId);
  const types = [lc && lc.candidateType, rc && rc.candidateType];
  const route = t(types.includes('relay') ? 'über Relay-Server' : types.every((x) => x === 'host') ? 'im eigenen Netz' : 'direkt übers Internet');

  const g = grade(rtt, loss);
  const dot = $('signal').querySelector('.sig-dot');
  dot.className = 'sig-dot ' + g;
  $('sigText').textContent = (rtt != null ? rtt + ' ms' : '') + (loss >= 0.5 ? ' · ' + t('{n} % Verlust', { n: loss.toFixed(1) }) : '');
  $('signal').title = (GRADE_TEXT[g] ? t(GRADE_TEXT[g]) : '') + ', ' + route;
  $('signal').classList.toggle('alert', g === 'bad'); // schlechte Verbindung bleibt sichtbar
  $('signal').hidden = false;
}

// Teilender: schlechteste Verbindung aller Zuschauer als Punkt neben der Zuschauerzahl.
setInterval(async () => {
  const dot = $('hostSignal');
  if (!host.stream || !host.calls.size) { dot.hidden = true; return; }
  const rank = { good: 0, mid: 1, bad: 2 };
  let worst = '';
  const lines = [];
  for (const { call, conn } of host.calls.values()) {
    const r = await call.peerConnection.getStats();
    r.forEach((s) => {
      if (s.type !== 'remote-inbound-rtp' || s.kind !== 'video') return;
      const rtt = s.roundTripTime != null ? Math.round(s.roundTripTime * 1000) : null;
      const loss = (s.fractionLost || 0) * 100;
      const g = grade(rtt, loss);
      if (g && (!worst || rank[g] > rank[worst])) worst = g;
      lines.push((viewerName(conn) || t('Zuschauer')) + ': ' + (rtt ?? '?') + ' ms, ' + t('{n} % Verlust', { n: loss.toFixed(1) }));
    });
  }
  dot.className = 'sig-dot ' + worst;
  dot.title = lines.join('\n');
  dot.hidden = !worst;
  renderBar();
}, 3000);
