// Panel UI: receives board frames from the page, runs recognition (worker),
// tracks the position and drives Stockfish (worker) with MultiPV 3.
import { BeliefTracker, pvToSan, sqToImage, cellsOf } from './position.js';
import { Chess } from './lib/chess.js';
import { classify, LABELS, iconSVG } from './annotate.js';

const $ = (id) => document.getElementById(id);
const parentPost = (msg) => parent.postMessage(msg, '*');
const MULTIPV = 3, MAX_DEPTH = 24;

const tracker = new BeliefTracker();
let orientMode = 'auto';
let paused = false;
let maxHz = 30;
try { maxHz = Number(localStorage.getItem('maxHz')) || 30; } catch {}
let lastConf = null;
let frameId = 0, frameT = [], recogMs = [];
// board presence, with hysteresis so one odd frame doesn't flip it
let boardPresent = false, presentRun = 0, absentRun = 0;
// move labels (chess.com style), optional
const evalCache = new Map();   // fen -> {fen, depth, lines}
const moveLabels = new Map();  // belief id -> {label, final}
let showLabels = true;
try { showLabels = localStorage.getItem('labels') !== 'off'; } catch {}

function lastMoveLabel() {
  const b = tracker.best;
  if (!showLabels || !boardPresent || !b || !b.prevFen || !b.moves.length) return null;
  const known = moveLabels.get(b.id);
  if (known && known.final) return known;
  const prevLabel = (moveLabels.get(b.parentId) || {}).label;
  const res = classify(b.moves[b.moves.length - 1], evalCache.get(b.prevFen), evalCache.get(b.fen), prevLabel);
  if (res) moveLabels.set(b.id, res);
  return res || known || null;
}

// ---------------- recognition ----------------
const recog = new Worker('recog-worker.js');
const coordWorker = new Worker('coords-worker.js');
coordWorker.onmessage = (e) => { if (e.data.type === 'coords') { window.__coordMs = e.data.ms; onCoords(e.data); } };
recog.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'error') { setStatus('error', 'recognizer failed to load: ' + m.error); parentPost({ type: 'frame-done' }); return; }
  if (m.type !== 'result') return;
  parentPost({ type: 'frame-done' });          // free the capture slot right away; the work below is local
  const now = performance.now();
  recogMs.push([now, m.ms]);
  const tUpd = performance.now() + performance.timeOrigin;
  const res = tracker.update(m.probs, m.pair, orientMode, m.tinted);
  if (window.__dbg) window.__dbg.push([performance.now() + performance.timeOrigin, m.pair ? m.pair.join('-') : '-', tracker.lastDecision, res.changed, m.sent, Math.round(m.ms), m.computed, Math.round(performance.now() + performance.timeOrigin - tUpd)]);
  lastConf = tracker.conf;
  updatePresence(looksLikeBoard(m));
  checkBoardChange();
  if (res.changed && boardPresent) onPosition();
  renderPending = true;                       // DOM updates at most once per animation frame
  frameT.push(now);
};

// A new game (possibly shown from the other side) or a jump in the video:
// many squares changed at once, or a move that doesn't continue the game.
// Ask for the coordinate labels right away instead of waiting for the next
// once-a-second reading.
let prevLabels = null, lastCoordsNow = 0;
function checkBoardChange() {
  const L = tracker.labels;
  let diff = 0;
  if (prevLabels) for (let i = 0; i < 64; i++) if (L[i] !== prevLabels[i]) diff++;
  prevLabels = L;
  const surprise = tracker.unexplained; tracker.unexplained = false;
  if (orientMode !== 'auto' || !boardPresent) return;
  const now = performance.now();
  if ((diff >= 10 || surprise) && now - lastCoordsNow > 400) { lastCoordsNow = now; parentPost({ type: 'coords-now' }); }
}

// A scan looks like a board when the squares alternate between two clear
// colours and the classifier is confident, with pieces of both colours.
function looksLikeBoard(m) {
  const labels = tracker.labels, conf = tracker.conf;
  const meanConf = conf.reduce((a, b) => a + b, 0) / 64;
  let white = 0, black = 0;
  for (const c of labels) if (c !== '.') { if (c === c.toUpperCase()) white++; else black++; }
  return m.contrast > 20 && m.spread < 0.45 * m.contrast && meanConf > 0.7 && white > 0 && black > 0;
}

function updatePresence(ok) {
  if (ok) { presentRun++; absentRun = 0; } else { absentRun++; presentRun = 0; }
  if (!boardPresent && presentRun >= 2) {
    boardPresent = true;
    if (tracker.best) onPosition(); else renderLines();
  } else if (boardPresent && absentRun >= 3) {
    boardPresent = false;
    stopAnalysis();
  }
}

function stopAnalysis() {
  if (searching) { ignoreUntilBestmove = true; engine.postMessage('stop'); }
  pendingFen = null; currentFen = null; lines = []; seed = null; renderLines();
}

let renderPending = false;
(function uiLoop() {
  if (renderPending) { renderPending = false; renderInfo(); renderMini(); }
  requestAnimationFrame(uiLoop);
})();

// scan stats, refreshed twice a second (averaged so the numbers don't flicker)
setInterval(() => {
  const now = performance.now();
  frameT = frameT.filter((t) => t > now - 2000);
  recogMs = recogMs.filter(([t]) => t > now - 2000);
  const avg = recogMs.length ? recogMs.reduce((a, [, v]) => a + v, 0) / recogMs.length : 0;
  $('perf').textContent = frameT.length ? `${(frameT.length / 2).toFixed(1)} scans/s · ${Math.round(avg)} ms` : '';
}, 500);

window.addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data || {};
  if (m.type === 'frame') recog.postMessage({ type: 'frame', id: ++frameId, buf: m.buf, sent: m.sent }, [m.buf]);
  else if (m.type === 'coordframe') coordWorker.postMessage(m, [m.buf]);
  else if (m.type === 'reset') { recog.postMessage({ type: 'reset' }); tracker.reset(); boardPresent = false; presentRun = absentRun = 0; clearAnalysis(); }
  else if (m.type === 'status') setStatus(m.text, m.detail);
  else if (m.type === 'fps') { videoFps = m.value; if (statusKind === 'scanning') setStatus('scanning'); }
});

let videoFps = 0, statusKind = null, statusDetail = null;
function setStatus(kind, detail) {
  statusKind = kind; statusDetail = detail;
  const el = $('status'), t = $('statusText');
  el.className = '';
  const map = {
    select: ['Drag a box around the board in the video…', 'warn'],
    scanning: [`Scanning · ${maxHz} Hz` + (videoFps && videoFps < maxHz ? ` (capped to video fps of ${videoFps})` : ''), 'live'],
    novideo: ['No readable video under that box. Only videos can be analysed.', 'warn'],
    noregion: ['No board selected', 'warn'],
    ad: ['Ad playing. Scanning resumes when it ends.', 'warn'],
    waiting: ['Waiting for the video…', 'warn'],
    error: ['Capture error: ' + (detail || ''), 'warn'],
  };
  const [text, cls] = map[kind] || [kind, ''];
  t.textContent = paused && cls === 'live' ? 'Paused' : text;
  if (cls && !(paused && cls === 'live')) el.classList.add(cls);
}

function showMsg(text) {
  const el = $('msg');
  if (!text) { el.hidden = true; return; }
  el.hidden = false; el.textContent = text;
}

// ---------------- engine ----------------
const engine = new Worker('engine/stockfish-19-lite-single.js');
let engineReady = false, searching = false, pendingFen = null, currentFen = null, ignoreUntilBestmove = false;
let lines = [];
engine.onmessage = (e) => {
  const line = typeof e.data === 'string' ? e.data : '';
  if (line === 'uciok') { engine.postMessage(`setoption name MultiPV value ${MULTIPV}`); engine.postMessage('isready'); }
  else if (line === 'readyok') { if (!engineReady) { engineReady = true; if (pendingFen) startSearch(); } }
  else if (line.startsWith('bestmove')) {
    searching = false; ignoreUntilBestmove = false;
    if (pendingFen) startSearch();
  } else if (line.startsWith('info') && !ignoreUntilBestmove && line.includes(' pv ')) parseInfo(line);
};
engine.postMessage('uci');

// pendingFen: {cmd, fen} — cmd carries the move history so the engine sees repetitions
function analyze(fen) {
  pendingFen = fen;
  if (!engineReady) return;
  if (searching) { ignoreUntilBestmove = true; engine.postMessage('stop'); }
  else startSearch();
}
// What the panel shows while a new search is still shallow:
// - the position was searched before (seek back, replay): its cached lines
// - the move played was in the previous position's lines: that line, one ply on
// The live search replaces it once it is about as deep.
let seed = null;
const SEED_CAP = 30;

function seedFor(prevFen, prevLines, fen) {
  const cached = evalCache.get(fen);
  if (cached && cached.depth > 0) return { depth: cached.depth, lines: cached.lines.slice() };
  if (!prevFen || !prevLines.length) return null;
  const key = (f) => f.split(' ').slice(0, 2).join(' ');
  for (const l of prevLines) {
    if (!l || !l.pv[0] || l.depth < 2) continue;
    const c = new Chess();
    try { c.load(prevFen, { skipValidation: true }); c.move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] || undefined }); }
    catch { continue; }
    if (key(c.fen()) !== key(fen)) continue;
    const val = l.kind === 'mate' ? (l.val > 0 ? -(l.val - 1) : -l.val) : -l.val;
    return { depth: l.depth - 1, lines: [{ depth: l.depth - 1, kind: l.kind, val, pv: l.pv.slice(1) }] };
  }
  return null;
}

// lines to display: whichever is deeper, the seed (shown the instant the move
// lands) or the live search. A new position with no seed shows live results
// immediately, from depth 1.
function shownLines() {
  const liveDepth = (lines[0] || {}).depth || 0;
  if (seed && liveDepth < Math.min(seed.depth, SEED_CAP)) return seed.lines;
  return lines;
}

function startSearch() {
  const job = pendingFen; pendingFen = null;
  seed = seedFor(currentFen, lines, job.fen);
  lines = []; searching = true;
  currentFen = job.fen;
  engine.postMessage(job.cmd);
  engine.postMessage(`go depth ${MAX_DEPTH}`);
  renderLines(); scheduleRender();
}

function parseInfo(line) {
  const t = line.split(' ');
  const get = (k) => { const i = t.indexOf(k); return i < 0 ? null : t[i + 1]; };
  const mpv = Number(get('multipv') || 1), depth = Number(get('depth'));
  const si = t.indexOf('score');
  if (si < 0 || t.includes('lowerbound') || t.includes('upperbound')) return;
  const kind = t[si + 1], val = Number(t[si + 2]);
  const pv = t.slice(t.indexOf('pv') + 1);
  lines[mpv - 1] = { depth, kind, val, pv };
  // remember evaluations per position, for labelling the next move
  if (currentFen) {
    evalCache.set(currentFen, { fen: currentFen, depth: (lines[0] || {}).depth || 0, lines: lines.slice() });
    if (evalCache.size > 300) evalCache.delete(evalCache.keys().next().value);
  }
  scheduleRender();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return; renderQueued = true;
  setTimeout(() => { renderQueued = false; renderLines(); }, 100);
}

function whitePov(l) {
  const stm = currentFen.split(' ')[1];
  return stm === 'w' ? l.val : -l.val;
}
function fmtScore(l) {
  const v = whitePov(l);
  if (l.kind === 'mate') return (v > 0 ? '#' : '-#') + Math.abs(v);
  const p = v / 100;
  return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(2);
}
function barPct(l) {
  const v = whitePov(l);
  if (l.kind === 'mate') return v > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368 * v)) - 1);
}

function renderLines() {
  const lines = shownLines();
  const ol = $('lines'); ol.innerHTML = '';
  const valid = lines.filter(Boolean);
  if (!currentFen || !valid.length) {
    $('evalNum').textContent = '–'; $('evalFill').style.width = '50%';
    $('depth').textContent = !boardPresent ? 'No board' : currentFen ? 'Thinking…' : 'Waiting for a position…';
    for (let i = 0; i < MULTIPV; i++) ol.appendChild(document.createElement('li'));
    parentPost({ type: 'arrows', arrows: [], badge: badgeFor(lastMoveLabel()) });
    renderLabel();
    return;
  }
  const top = lines[0] || valid[0];
  $('evalNum').textContent = fmtScore(top);
  $('evalFill').style.width = barPct(top) + '%';
  $('depth').textContent = `Depth ${top.depth} · Stockfish 19 lite`;
  const stm = currentFen.split(' ')[1];
  for (let i = 0; i < MULTIPV; i++) {
    const li = document.createElement('li'); const l = lines[i];
    if (l) {
      const sc = document.createElement('span');
      sc.className = 'sc ' + (whitePov(l) >= 0 ? 'w' : 'b'); sc.textContent = fmtScore(l);
      const pv = document.createElement('span'); pv.className = 'pv';
      const sans = pvToSan(currentFen, l.pv, 12);
      let n = Number(currentFen.split(' ')[5]) || 1, white = stm === 'w', html = '';
      sans.forEach((s, k) => {
        if (white) html += `<span class="n">${n}.</span> `;
        else if (k === 0) html += `<span class="n">${n}…</span> `;
        html += k === 0 ? `<b>${s}</b> ` : `${s} `;
        if (!white) n++;
        white = !white;
      });
      pv.innerHTML = html;
      li.append(sc, pv);
    }
    ol.appendChild(li);
  }
  // arrows for the first move of each line, in image coordinates
  const wb = tracker.whiteBottom;
  const arrows = [];
  lines.forEach((l, i) => {
    if (!l || !l.pv[0]) return;
    const u = l.pv[0];
    if (arrows.some((a) => a.u === u)) return;
    arrows.push({ u, rank: i, from: sqToImage(u.slice(0, 2), wb), to: sqToImage(u.slice(2, 4), wb) });
  });
  parentPost({ type: 'arrows', arrows, badge: badgeFor(lastMoveLabel()) });
  renderLabel();
}

function badgeFor(res) {
  const b = tracker.best;
  if (!res || !b) return null;
  const L = LABELS[res.label], to = b.moves[b.moves.length - 1].slice(2, 4);
  return { ...sqToImage(to, tracker.whiteBottom), svg: iconSVG(res.label) };
}

function renderLabel() {
  const el = $('moveLabel'), res = lastMoveLabel();
  if (!res) { el.hidden = true; return; }
  const L = LABELS[res.label];
  el.hidden = false;
  el.innerHTML = `<svg viewBox="0 0 20 21" width="17" height="18">${iconSVG(res.label)}</svg><span></span>`;
  el.lastChild.textContent = L.name; el.lastChild.style.color = L.color;
}

function clearAnalysis() {
  if (searching) { ignoreUntilBestmove = true; engine.postMessage('stop'); }
  pendingFen = null; currentFen = null; lines = []; seed = null; renderLines(); renderInfo(); renderMini();
}

// ---------------- position updates ----------------
function onPosition() {
  const b = tracker.best; if (!b || !boardPresent) return;
  const g = new Chess(); g.load(b.fen, { skipValidation: true });
  if (g.isCheckmate() || g.isStalemate()) {
    if (searching) { ignoreUntilBestmove = true; engine.postMessage('stop'); }
    pendingFen = null; currentFen = b.fen; lines = []; seed = null; renderLines();
    $('evalNum').textContent = g.isCheckmate() ? (g.turn() === 'w' ? '0-1' : '1-0') : '½-½';
    $('evalFill').style.width = g.isCheckmate() ? (g.turn() === 'w' ? '0%' : '100%') : '50%';
    $('depth').textContent = g.isCheckmate() ? 'Checkmate' : 'Stalemate';
    return;
  }
  analyze({ cmd: tracker.positionCommand(), fen: b.fen });
}

function moveLabel(b) {
  if (!b.moves.length) return null;
  const n = b.sans.length, stm = b.fen.split(' ')[1];
  // move number of the last move, counted from the root position
  const root = b.rootFen.split(' '), rootNo = Number(root[5]) || 1, rootWhite = root[1] === 'w';
  const plyIndex = n - 1 + (rootWhite ? 0 : 1);
  const no = rootNo + Math.floor(plyIndex / 2);
  return `${no}${stm === 'b' ? '.' : '…'} ${b.sans[n - 1]}`;
}

function renderInfo() {
  { const as = $('autoSide'); const t = orientMode === 'auto' ? `(${tracker.whiteBottom ? 'White' : 'Black'})` : ''; if (as && as.textContent !== t) as.textContent = t; }
  const b = tracker.best;
  if (!boardPresent) {
    $('toMove').textContent = 'No chessboard detected';
    $('history').textContent = 'Engine analysis is off until a board is visible in the box.';
  } else if (!b) {
    $('toMove').textContent = 'Waiting for a move';
    $('history').textContent = 'Analysis starts once a move is highlighted on the board.';
  } else {
    const stm = b.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
    const last = moveLabel(b);
    $('toMove').textContent = `${stm} to move`;
    $('history').textContent = b.moves.length
      ? `after ${last} · ${b.moves.length} move${b.moves.length > 1 ? 's' : ''} of history`
      : `last move ${tracker.rawPair ? tracker.rawPair.join('-') : ''} · no history yet`;
  }
  $('fen').textContent = b ? b.fen : '';
  const how = orientMode !== 'auto' ? 'set by you' : tracker.coordHint !== null ? 'from board coordinates' : ({ legality: 'from move legality', pawns: 'guessed from pawns', pieces: 'guessed from piece placement' }[tracker.orientBy] || 'guessed (white at the bottom)');
  $('scanInfo').textContent = `Last scan: ${tracker.lastDecision} · ${tracker.history.length} beliefs kept · orientation ${how}`;
}

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
function renderMini() {
  const box = $('mini');
  if (!$('boardBox').open) return;
  box.innerHTML = '';
  const cells = tracker.best ? cellsOf(tracker.best.fen) : null, wb = tracker.whiteBottom;
  for (let ir = 0; ir < 8; ir++) for (let ic = 0; ic < 8; ic++) {
    const d = document.createElement('div');
    const r = wb ? ir : 7 - ir, f = wb ? ic : 7 - ic;
    d.className = (r + f) % 2 ? 'd' : 'l';
    const c = cells ? cells[r * 8 + f] : '.';
    if (c !== '.') { d.textContent = GLYPH[c.toUpperCase()]; d.classList.add(c === c.toUpperCase() ? 'w' : 'bk'); }
    if (lastConf && lastConf[ir * 8 + ic] < 0.6) d.classList.add('u');
    box.appendChild(d);
  }
}
$('boardBox').addEventListener('toggle', renderMini);

// ---------------- controls ----------------
// Orientation from the board's rank/file labels. Two readings in a row must
// agree to set it; overturning an orientation already in use takes three.
let coordPrev = null, coordStreak = 0;
function onCoords(m) {
  if (orientMode !== 'auto') return;
  const v = m.orient;                          // 'white' | 'black' | null (no labels found)
  coordStreak = v && v === coordPrev ? coordStreak + 1 : 1;
  coordPrev = v;
  if (v) {
    const wb = v === 'white';
    const changing = tracker.coordHint !== null && tracker.coordHint !== wb;
    if (coordStreak >= (changing ? 3 : 2)) {
      const flipped = tracker.setCoordHint(wb);
      if (flipped) { clearAnalysis(); parentPost({ type: 'rescan' }); }
    }
  }
  renderInfo();
}

$('orientSeg').addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('button'); const v = btn && btn.dataset.v; if (!v) return;
  orientMode = v; coordPrev = null; coordStreak = 0;
  parentPost({ type: 'coords-wanted', value: v === 'auto' });
  for (const b of $('orientSeg').children) b.classList.toggle('on', b.dataset.v === v);
  tracker.reset(); clearAnalysis();
  parentPost({ type: 'rescan' });   // re-read the current frame now (the video may be paused)
});
$('pause').onclick = () => {
  paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause';
  parentPost({ type: 'pause', value: paused });
  setStatus(statusKind || 'scanning', statusDetail);
};
$('reselect').onclick = () => parentPost({ type: 'reselect' });
$('arrows').onchange = (e) => parentPost({ type: 'show-arrows', value: e.target.checked });
$('labels').checked = showLabels;
$('labels').onchange = (e) => {
  showLabels = e.target.checked;
  try { localStorage.setItem('labels', showLabels ? 'on' : 'off'); } catch {}
  renderLines();
};
$('copy').onclick = async () => {
  if (!tracker.best) return;
  try { await navigator.clipboard.writeText(tracker.best.fen); flash($('copy'), 'Copied'); }
  catch { flash($('copy'), 'Blocked'); }
};
$('lichess').onclick = () => {
  if (!tracker.best) return;
  window.open('https://lichess.org/analysis/standard/' + tracker.best.fen.replace(/ /g, '_'), '_blank', 'noopener');
};
function flash(btn, text) { const o = btn.textContent; btn.textContent = text; setTimeout(() => (btn.textContent = o), 900); }

new ResizeObserver(() => parentPost({ type: 'height', value: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body);
function setRate(hz, save) {
  maxHz = hz; $('rate').value = hz; $('rateVal').textContent = `${hz} Hz`;
  parentPost({ type: 'rate', value: hz });
  if (save) { try { localStorage.setItem('maxHz', String(hz)); } catch {} }
  if (statusKind === 'scanning') setStatus('scanning');
}
$('rate').addEventListener('input', (e) => setRate(Number(e.target.value), true));

renderLines(); renderInfo();
parentPost({ type: 'ready' });
setRate(maxHz, false);
