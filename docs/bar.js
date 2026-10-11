'use strict';
// Schwebende Leiste beim Teilen (Fensterlogik in bar.go). Klappt sich ohne Maus nach kurzer Zeit
// zu einem Reiter zusammen, Meldungen (Reaktionen, neue Zuschauer) klappen sie kurz auf.

const fbar = { active: false, collapsed: false, timer: 0, msgTimer: 0 };
const BAR_COLLAPSE_MS = 2500;

// Fenster -> Leiste. Go lässt das Fenster an den Rand gleiten und ruft danach onBarEntered().
function enterBar() {
  if (!native('barEnter') || fbar.active) return;
  cancelBarCountdown();
  fbar.active = true;
  fbar.collapsed = false;
  window.barEnter();
}

window.onBarEntered = () => {
  if (!fbar.active) return;
  document.body.classList.add('bar-mode');
  document.body.classList.remove('bar-collapsed');
  show('bar');
  renderBar();
  scheduleCollapse();
};

// ---------- Countdown: erst ein paar Sekunden das ganze Fenster, dann die Leiste ----------
const barCd = { timer: 0, left: 0, total: 0 };

function startBarCountdown(seconds = 5) {
  if (!native('barEnter')) return;
  barCd.total = barCd.left = seconds * 10; // Zehntelsekunden
  $('barCountdown').hidden = false;
  clearInterval(barCd.timer);
  const RING = 97.4; // Umfang des Kreises (2·π·15,5)
  const tick = () => {
    if (!host.stream) { cancelBarCountdown(); return; }
    barCd.left--; // läuft immer durch – wer das Fenster behalten will, klickt "Offen lassen"
    $('barCdNum').textContent = Math.max(0, Math.ceil(barCd.left / 10));
    $('barCdRing').style.strokeDashoffset = String(RING * (1 - barCd.left / barCd.total));
    if (barCd.left <= 0) enterBar();
  };
  tick();
  barCd.timer = setInterval(tick, 100);
}

function cancelBarCountdown() {
  clearInterval(barCd.timer);
  barCd.timer = 0;
  $('barCountdown').hidden = true;
}

$('barNow').addEventListener('click', enterBar);
$('barStay').addEventListener('click', cancelBarCountdown);

function leaveBar(target = 'host') {
  if (!fbar.active) return;
  fbar.active = false;
  clearTimeout(fbar.timer);
  document.body.classList.remove('bar-mode', 'bar-collapsed');
  window.barLeave();
  show(target);
}

function renderBar() {
  if (!fbar.active) return;
  $('fbCode').textContent = host.code;
  $('fbCount').textContent = host.calls.size;
  document.querySelectorAll('#fbMode button').forEach((b) => b.classList.toggle('active', b.dataset.q === host.live.mode));
  $('fbHeight').value = String(host.live.maxHeight);
  $('fbBitrate').value = String(host.live.maxBitrate);
  const hs = $('hostSignal');
  $('fbSignal').className = hs.className;
  $('fbSignal').hidden = hs.hidden;
  $('fbSignal').title = hs.title;
}

function setCollapsed(c) {
  if (!fbar.active || fbar.collapsed === c) return;
  fbar.collapsed = c;
  document.body.classList.toggle('bar-collapsed', c);
  window.barCollapse(c);
}

function scheduleCollapse(ms = BAR_COLLAPSE_MS) {
  clearTimeout(fbar.timer);
  fbar.timer = setTimeout(() => {
    // nicht zuklappen, solange eine Auswahlliste offen ist oder eine Meldung läuft
    if ($('fbar').matches(':hover') || document.activeElement?.closest('.fbar select') || fbar.msgTimer) {
      scheduleCollapse(ms);
      return;
    }
    setCollapsed(true);
  }, ms);
}

// Meldung in der Leiste anzeigen (klappt sie dafür auf und erst danach wieder zu).
function barMessage(text, ms = 4500) {
  if (!fbar.active) return false;
  $('fbMsg').textContent = text;
  setCollapsed(false);
  clearTimeout(fbar.msgTimer);
  fbar.msgTimer = setTimeout(() => {
    fbar.msgTimer = 0;
    $('fbMsg').textContent = '';
    scheduleCollapse();
  }, ms);
  return true;
}

$('fbar').addEventListener('mouseenter', () => { clearTimeout(fbar.timer); setCollapsed(false); });
$('fbar').addEventListener('mouseleave', () => scheduleCollapse());

// Ziehen an freien Stellen der Leiste verschiebt sie (rastet oben/unten ein)
$('fbar').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button, select')) return;
  e.preventDefault();
  if (native('barDrag')) window.barDrag();
});

$('fbCode').addEventListener('click', async () => {
  const ok = await copyCode();
  barMessage(t(ok ? 'Kopiert!' : 'Kopieren nicht möglich'));
});
document.querySelectorAll('#fbMode button').forEach((b) => b.addEventListener('click', () => {
  host.live.mode = b.dataset.q;
  renderQuick();
  renderBar();
  applyLive();
}));
$('fbHeight').addEventListener('change', () => { host.live.maxHeight = Number($('fbHeight').value); renderQuick(); applyLive(); });
$('fbBitrate').addEventListener('change', () => { host.live.maxBitrate = Number($('fbBitrate').value); renderQuick(); applyLive(); });
// Die Bildschirmauswahl braucht Platz: dafür kurz zum Fenster, danach zurück zur Leiste
$('fbSource').addEventListener('click', async () => {
  leaveBar('host');
  await switchSource();
  if (host.stream) enterBar();
});
$('fbWindow').addEventListener('click', () => leaveBar('host'));
$('fbStop').addEventListener('click', () => stopHost());
$('btnToBar').addEventListener('click', enterBar);
