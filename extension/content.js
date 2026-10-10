// Injected into the page when the toolbar button is clicked.
// Handles board selection, 5 Hz frame grabbing from the <video>, the floating
// panel (an extension iframe that runs recognition + Stockfish) and the
// best-move arrows drawn over the video.
(() => {
  'use strict';
  if (window.__liveChessAnalysis) { window.__liveChessAnalysis.toggle(); return; }
  const G = self.ChessGuard;
  if (!G || G.isBlockedHost(location.hostname)) return;   // never on chess playing sites

  let scanMs = 33;                 // max scan rate, set from the panel (default 30 Hz)
  const BOARD_PX = 256;           // 8 x 32px squares for the model
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  const st = {
    region: null,      // {kind:'video', video, nx, ny, nw, nh} normalized to the video frame
    running: false, paused: false, busy: false, timer: null,
    arrows: [], showArrows: true, lastScanMs: 0,
  };

  // ---------- floating panel ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:80px;right:24px;z-index:2147483646;width:340px;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .wrap{background:#16181d;border:1px solid #2c3038;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden;font:12px/1.3 system-ui,sans-serif;color:#d8dbe2}
      .bar{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1d2027;cursor:grab;user-select:none}
      .bar:active{cursor:grabbing}
      .title{flex:1;font-weight:600;letter-spacing:.2px}
      button{all:unset;cursor:pointer;width:22px;height:22px;display:grid;place-items:center;border-radius:5px;color:#9aa1ad;font-size:14px}
      button:hover{background:#2a2e37;color:#fff}
      iframe{display:block;width:100%;border:0;height:360px;background:#16181d}
      .min iframe{display:none}
    </style>
    <div class="wrap"><div class="bar"><span class="title">♞ Simple Chess Video Analyzer Extension</span>
      <button data-a="min" title="Minimize">–</button><button data-a="close" title="Close">✕</button></div>
      <iframe allow="clipboard-write"></iframe></div>`;
  const wrap = shadow.querySelector('.wrap');
  const iframe = shadow.querySelector('iframe');
  iframe.src = chrome.runtime.getURL('panel.html');
  shadow.querySelector('[data-a=min]').onclick = () => wrap.classList.toggle('min');
  shadow.querySelector('[data-a=close]').onclick = () => shutdown();
  dragBy(shadow.querySelector('.bar'), host);

  // ---------- arrow overlay over the board ----------
  const svgNS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.setAttribute('viewBox', '0 0 8 8');
  overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;display:none;overflow:visible';
  overlay.innerHTML = `<defs>${[0, 1, 2].map((i) => `<marker id="lca-h${i}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${arrowColor(i)}"/></marker>`).join('')}</defs><g></g>`;
  const arrowG = overlay.querySelector('g');
  function arrowColor(i) { return ['rgba(40,170,255,.85)', 'rgba(40,170,255,.5)', 'rgba(40,170,255,.32)'][i]; }

  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    if (overlay.parentNode !== parent) parent.appendChild(overlay);
  }
  document.addEventListener('fullscreenchange', () => { mount(); placeOverlay(); });
  mount();

  function dragBy(handle, el) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.left = Math.max(0, Math.min(innerWidth - 60, r.left + ev.clientX - sx)) + 'px';
        el.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px';
        el.style.right = 'auto';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  }

  // ---------- messaging with the panel ----------
  function toPanel(msg, transfer) { iframe.contentWindow && iframe.contentWindow.postMessage(msg, EXT_ORIGIN, transfer || []); }
  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== EXT_ORIGIN) return;
    const m = e.data || {};
    switch (m.type) {
      case 'ready': if (!st.region) startSelect(); else toPanel({ type: 'status', text: 'scanning' }); break;
      case 'frame-done': st.inFlight = Math.max(0, (st.inFlight || 0) - 1); schedule(); break;
      case 'rescan': frameSeq++; confirmed = false; schedule(); break;   // treat the current frame as new
      case 'coords-wanted': coordsWanted = !!m.value; lastCoordAt = 0; break;
      case 'coords-now':                       // the board changed a lot: re-read the labels now, then a few more times quickly
        coordBurst = 3;
        if (coordsWanted && st.running) { const v = usableVideo(); if (v) { lastCoordAt = performance.now(); try { sendCoordFrame(v); } catch (e) {} } }
        break;
      case 'arrows': st.arrows = m.arrows || []; st.badge = m.badge || null; drawArrows(); break;
      case 'show-arrows': st.showArrows = !!m.value; drawArrows(); break;
      case 'pause': st.paused = !!m.value; if (!st.paused) { frameSeq++; schedule(); } break;
      case 'rate': {
        const hz = Math.min(60, Math.max(0.5, Number(m.value) || 30));
        scanMs = Math.round(1000 / hz);
        schedule();
        break;
      }
      case 'reselect': startSelect(); break;
      case 'height': iframe.style.height = Math.min(640, Math.max(120, m.value)) + 'px'; break;
    }
  });

  // ---------- board selection ----------
  let selecting = false;
  function startSelect() {
    if (selecting) return;
    selecting = true; st.running = false; clearInterval(st.timer);
    toPanel({ type: 'status', text: 'select' });
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.25)';
    const tip = document.createElement('div');
    tip.textContent = 'Drag a box around the chessboard (just the 64 squares). Esc to cancel.';
    tip.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#16181d;color:#fff;padding:8px 14px;border-radius:8px;font:13px system-ui,sans-serif;pointer-events:none';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #28aaff;background:rgba(40,170,255,.12);display:none;pointer-events:none';
    layer.append(tip, box);
    (document.fullscreenElement || document.documentElement).appendChild(layer);
    let sx = 0, sy = 0, down = false;
    const finish = (rect) => {
      selecting = false; layer.remove(); document.removeEventListener('keydown', onKey, true);
      if (rect && rect.w > 40 && rect.h > 40) setRegion(rect);
      else if (st.region) startLoop();
      else toPanel({ type: 'status', text: 'noregion' });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    layer.addEventListener('pointerdown', (e) => { e.preventDefault(); down = true; sx = e.clientX; sy = e.clientY; layer.setPointerCapture(e.pointerId); });
    layer.addEventListener('pointermove', (e) => {
      if (!down) return;
      // keep the box square: boards are square
      const s = Math.max(Math.abs(e.clientX - sx), Math.abs(e.clientY - sy));
      const x = e.clientX < sx ? sx - s : sx, y = e.clientY < sy ? sy - s : sy;
      Object.assign(box.style, { display: 'block', left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px' });
      box.dataset.r = JSON.stringify({ x, y, w: s, h: s });
    });
    layer.addEventListener('pointerup', () => { down = false; finish(box.dataset.r ? JSON.parse(box.dataset.r) : null); });
  }

  // client rect of the displayed video picture (handles letterboxing / object-fit)
  function videoContentRect(v) {
    const r = v.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const fit = getComputedStyle(v).objectFit;
    let sx, sy;
    if (fit === 'fill') { sx = r.width / vw; sy = r.height / vh; }
    else if (fit === 'cover') { sx = sy = Math.max(r.width / vw, r.height / vh); }
    else { sx = sy = Math.min(r.width / vw, r.height / vh); }
    return { left: r.left + (r.width - vw * sx) / 2, top: r.top + (r.height - vh * sy) / 2, sx, sy, vw, vh };
  }

  function findVideo(rect) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, rect.x + rect.w) - Math.max(r.left, rect.x));
      const iy = Math.max(0, Math.min(r.bottom, rect.y + rect.h) - Math.max(r.top, rect.y));
      const a = ix * iy + (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom ? 1e9 : 0);
      if (a > bestArea && v.videoWidth) { best = v; bestArea = a; }
    }
    return best;
  }

  function videoReadable(v) {
    try { const c = new OffscreenCanvas(2, 2).getContext('2d'); c.drawImage(v, 0, 0, 2, 2); c.getImageData(0, 0, 1, 1); return true; }
    catch { return false; }
  }

  function setRegion(rect) {
    const v = findVideo(rect);
    if (v && videoReadable(v)) {
      const cr = videoContentRect(v);
      const nx = (rect.x - cr.left) / cr.sx / cr.vw, ny = (rect.y - cr.top) / cr.sy / cr.vh;
      st.region = { kind: 'video', video: v, nx, ny, nw: rect.w / cr.sx / cr.vw, nh: rect.h / cr.sy / cr.vh };
      snapVideoRegion();
    } else {
      st.region = null; toPanel({ type: 'status', text: 'novideo' }); return;
    }
    toPanel({ type: 'reset' });
    placeOverlay(); startLoop();
  }

  // Snap the rough box onto the real 8x8 grid using the current video frame.
  function snapVideoRegion() {
    const R = st.region, v = R.video, vw = v.videoWidth, vh = v.videoHeight;
    const pad = 0.12;
    const x0 = Math.max(0, (R.nx - R.nw * pad) * vw), y0 = Math.max(0, (R.ny - R.nh * pad) * vh);
    const x1 = Math.min(vw, (R.nx + R.nw * (1 + pad)) * vw), y1 = Math.min(vh, (R.ny + R.nh * (1 + pad)) * vh);
    const w = Math.round(x1 - x0), h = Math.round(y1 - y0);
    if (w < 40 || h < 40) return;
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    c.drawImage(v, x0, y0, w, h, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h);
    const box = { x: R.nx * vw - x0, y: R.ny * vh - y0, w: R.nw * vw, h: R.nh * vh };
    const s = self.ChessSnap.snapBoard(img.data, w, h, box);
    if (s.score > 1.3) {
      R.nx = (s.x + x0) / vw; R.ny = (s.y + y0) / vh; R.nw = s.w / vw; R.nh = s.h / vh;
    }
  }

  // ---------- capture loop ----------
  const boardCanvas = new OffscreenCanvas(BOARD_PX, BOARD_PX);
  const bctx = boardCanvas.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';

  // Scanning is driven by the video's own frames: every newly presented frame
  // is scanned once (requestVideoFrameCallback), never more often than the max
  // rate. A frame that arrives too early or while a scan is running is scanned
  // as soon as allowed (only the newest one). When no new frame comes (paused),
  // the last frame is scanned once more so the reading can be confirmed.
  // A slow watchdog handles ads, replaced video elements, the URL guard and
  // keeping the overlay in place.
  const CONFIRM_MS = 250;
  const MAX_IN_FLIGHT = 2;            // one frame being read while the next is captured
  let frameSeq = 0, scannedSeq = 0, lastScanAt = 0, confirmed = false;
  let waitTimer = null, confirmTimer = null, rvfcVideo = null;

  function startLoop() {
    clearInterval(st.timer); st.running = true; st.inFlight = 0;
    st.timer = setInterval(watchdog, 250);
    lastStatus = null; frameSeq++; watchdog(); schedule();
  }

  function hookFrames(v) {
    if (rvfcVideo === v || typeof v.requestVideoFrameCallback !== 'function') return;
    rvfcVideo = v;
    const deltas = []; let lastMedia = null, sentFps = 0;
    const onFrame = (now, meta) => {
      if (rvfcVideo !== v) return;           // a newer element took over
      // video frame rate = typical media-time step between consecutive frames
      if (lastMedia !== null) {
        const d = meta.mediaTime - lastMedia;
        if (d > 0.004 && d < 0.5) { deltas.push(d); if (deltas.length > 40) deltas.shift(); }
        if (deltas.length >= 10) {
          const med = deltas.slice().sort((a, b) => a - b)[deltas.length >> 1];
          // snap to standard video rates (29.97 -> 30, 23.976 -> 24) so the reading doesn't flicker
          const raw = 1 / med, STD = [24, 25, 30, 48, 50, 60];
          const near = STD.find((r) => Math.abs(r - raw) < 1.5);
          const fps = near || Math.round(raw);
          if (fps !== sentFps) { sentFps = fps; toPanel({ type: 'fps', value: fps }); }
        }
      }
      lastMedia = meta.mediaTime;
      frameSeq++; schedule();
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  // scan now if allowed, otherwise when the rate limit / current scan permits
  function schedule() {
    if (!st.running || st.paused || (st.inFlight || 0) >= MAX_IN_FLIGHT || document.hidden) return;
    const pending = frameSeq !== scannedSeq;
    if (!pending) {
      // nothing new: confirm the last frame once after a short quiet period
      if (!confirmed && !confirmTimer) confirmTimer = setTimeout(() => { confirmTimer = null; if (!confirmed && frameSeq === scannedSeq) { confirmed = true; scan(); } }, CONFIRM_MS);
      return;
    }
    const wait = lastScanAt + scanMs - performance.now();
    if (wait > 0) { if (!waitTimer) waitTimer = setTimeout(() => { waitTimer = null; schedule(); }, wait); return; }
    scannedSeq = frameSeq; confirmed = false;
    clearTimeout(confirmTimer); confirmTimer = null;
    scan();
  }

  function usableVideo() {
    const R = st.region;
    // The video can disappear for a moment (ad <-> content switch, quality change)
    // or be replaced by a new element: wait it out and re-attach, never give up.
    if (!R.video.isConnected) {
      const nv = mainVideo();
      if (!nv) { status('waiting'); return null; }
      R.video = nv;
    }
    const v = R.video;
    if (v.closest('.ad-showing, .ad-interrupting')) { status('ad'); return null; }   // YouTube ad playing
    if (!v.videoWidth || v.readyState < 2) { status('waiting'); return null; }
    status('scanning');
    return v;
  }

  // Board + half-square margin (576 px, 64 px squares) a few times a second, so
  // the panel can read the rank/file labels to work out the board's orientation.
  const COORD_SQ = 64, COORD_MARGIN = 32, COORD_PX = COORD_SQ * 8 + 2 * COORD_MARGIN;
  let coordsWanted = true, lastCoordAt = 0, coordBurst = 0;
  const coordCanvas = new OffscreenCanvas(COORD_PX, COORD_PX);
  const cctx = coordCanvas.getContext('2d', { willReadFrequently: true });
  cctx.imageSmoothingQuality = 'high';           // proper downscaling: labels are small
  function sendCoordFrame(v) {
    const R = st.region, vw = v.videoWidth, vh = v.videoHeight;
    const m = R.nw / 16, mh = R.nh / 16;          // half a square, normalised
    const sx = (R.nx - m) * vw, sy = (R.ny - mh) * vh, sw = (R.nw + 2 * m) * vw, sh = (R.nh + 2 * mh) * vh;
    cctx.fillStyle = '#000'; cctx.fillRect(0, 0, COORD_PX, COORD_PX);
    // clip the source rectangle to the video, mapping the destination accordingly
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(vw, sx + sw), cy1 = Math.min(vh, sy + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    const k = COORD_PX / sw, kh = COORD_PX / sh;
    cctx.drawImage(v, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * k, (cy0 - sy) * kh, (cx1 - cx0) * k, (cy1 - cy0) * kh);
    const img = cctx.getImageData(0, 0, COORD_PX, COORD_PX);
    toPanel({ type: 'coordframe', size: COORD_PX, sq: COORD_SQ, margin: COORD_MARGIN, buf: img.data.buffer }, [img.data.buffer]);
  }

  function watchdog() {
    placeOverlay();
    if (!st.running) return;
    // guard re-checked continuously (single-page sites can change URL without reloading)
    if (G.isBlockedHost(location.hostname)) { shutdown(); return; }
    const v = usableVideo();
    if (!v) return;
    if (typeof v.requestVideoFrameCallback === 'function') {
      if (rvfcVideo !== v) { hookFrames(v); frameSeq++; }
    } else frameSeq++;                         // no frame callbacks: fall back to polling at the max rate
    schedule();
    if (coordsWanted && !st.paused && !document.hidden && performance.now() - lastCoordAt > (coordBurst > 0 ? 120 : 400)) {
      lastCoordAt = performance.now(); if (coordBurst > 0) coordBurst--;
      try { sendCoordFrame(v); } catch (e) { /* ignore: next tick retries */ }
    }
  }

  function scan() {
    const R = st.region, v = usableVideo();
    if (!v) return;
    try {
      bctx.drawImage(v, R.nx * v.videoWidth, R.ny * v.videoHeight, R.nw * v.videoWidth, R.nh * v.videoHeight, 0, 0, BOARD_PX, BOARD_PX);
      const img = bctx.getImageData(0, 0, BOARD_PX, BOARD_PX);
      st.inFlight = (st.inFlight || 0) + 1; lastScanAt = performance.now();
      toPanel({ type: 'frame', w: BOARD_PX, h: BOARD_PX, buf: img.data.buffer, sent: performance.now() + performance.timeOrigin }, [img.data.buffer]);
    } catch (err) {
      st.inFlight = Math.max(0, (st.inFlight || 0) - 1);
      toPanel({ type: 'status', text: 'error', detail: String(err && err.message || err) });
    }
  }

  // only tell the panel when the state actually changes
  let lastStatus = null;
  function status(text) { if (text !== lastStatus) { lastStatus = text; toPanel({ type: 'status', text }); } }

  // the largest visible video with picture, used when the old element was replaced
  function mainVideo() {
    let best = null, bestA = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > bestA && v.videoWidth) { best = v; bestA = a; }
    }
    return best;
  }

  // ---------- overlay placement + arrows ----------
  function boardClientRect() {
    const R = st.region; if (!R) return null;
    const cr = videoContentRect(R.video); if (!cr) return null;
    return { x: cr.left + R.nx * cr.vw * cr.sx, y: cr.top + R.ny * cr.vh * cr.sy, w: R.nw * cr.vw * cr.sx, h: R.nh * cr.vh * cr.sy };
  }
  function placeOverlay() {
    const r = boardClientRect();
    if (!r || (!(st.showArrows && st.arrows.length) && !st.badge) || lastStatus !== 'scanning') { overlay.style.display = 'none'; return; }
    Object.assign(overlay.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
  function drawArrows() {
    arrowG.innerHTML = '';
    (st.showArrows ? st.arrows : []).slice().reverse().forEach((a) => {
      const i = a.rank;
      const x1 = a.from.col + 0.5, y1 = a.from.row + 0.5, x2 = a.to.col + 0.5, y2 = a.to.row + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2 - ux * 0.25); line.setAttribute('y2', y2 - uy * 0.25);
      line.setAttribute('stroke', arrowColor(i)); line.setAttribute('stroke-width', [0.17, 0.12, 0.1][i]);
      line.setAttribute('stroke-linecap', 'round'); line.setAttribute('marker-end', `url(#lca-h${i})`);
      line.setAttribute('vector-effect', 'none');
      arrowG.appendChild(line);
    });
    if (st.badge) {   // move label icon on the top-right corner of the destination square
      const b = st.badge, size = 0.42;
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', `translate(${b.col + 1 - size * 0.62} ${b.row - size * 0.38}) scale(${size / 20})`);
      g.innerHTML = b.svg;   // markup built by the extension's own panel
      arrowG.append(g);
    }
    placeOverlay();
  }
  addEventListener('resize', placeOverlay); addEventListener('scroll', placeOverlay, { passive: true });

  function shutdown() {
    clearInterval(st.timer); st.running = false;
    clearTimeout(waitTimer); clearTimeout(confirmTimer); rvfcVideo = null;
    host.remove(); overlay.remove();
    delete window.__liveChessAnalysis;
  }

  window.__liveChessAnalysis = {
    shutdown,
    toggle() {
      if (!host.isConnected) { mount(); }
      if (host.style.display === 'none') host.style.display = ''; else startSelect();
    },
  };
})();
