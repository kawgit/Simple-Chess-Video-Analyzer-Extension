"""E2E with realistic timeline: animation frame (0.15 s), settled (1.6 s),
hover/drag (1.0 s), settled again. Checks the panel's FEN against the truth."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
import json, shutil, sys, time, threading, http.server, functools
from playwright.sync_api import sync_playwright

EXT_SRC, EXT = os.path.join(ROOT, 'extension'), f'{HERE}/ext_test'
game = sys.argv[1]; err = float(sys.argv[2]) if len(sys.argv) > 2 else 6
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(EXT_SRC, EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] = ['<all_urls>']; json.dump(m, open(f'{EXT}/manifest.json', 'w'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Quiet, directory=f'{HERE}/site'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
truth = json.load(open(f'{HERE}/site/{game}/truth.json'))
HOLD = {'anim': 0.15, 'settled': 1.6, 'hover': 1.0}
checks = []; logs = []
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.gettempdir() + '/lca-pw2-' + game, headless=True, channel='chromium',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1280, 'height': 800})
    page = ctx.new_page(); page.on('console', lambda m: logs.append('page: ' + m.text))
    page.goto(f'http://127.0.0.1:8765/index.html?game={game}'); page.wait_for_function('window.__ready === true'); time.sleep(1)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    sw.evaluate("""async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url||t.pendingUrl||'').includes('127.0.0.1'));
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['guard.js', 'snap.js', 'content.js']}); }""")
    time.sleep(2.5)
    bx, by, bs = truth['box']; k = 0.75
    x0, y0, size = 60 + bx * k + err, 40 + by * k - err * 0.6, bs * k + err * 1.3
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 + size, y0 + size, steps=8); page.mouse.up()
    panel = None
    while not panel:
        panel = next((f for f in page.frames if 'panel.html' in f.url), None); time.sleep(0.1)
    for i, fr in enumerate(truth['frames']):
        page.evaluate(f'window.__set({i})')
        time.sleep(HOLD[fr['kind']])
        if fr['kind'] == 'anim': continue
        st = panel.evaluate("() => ({fen: document.getElementById('fen').textContent, tm: document.getElementById('toMove').textContent, hist: document.getElementById('history').textContent, scan: document.getElementById('scanInfo').textContent, ev: document.getElementById('evalNum').textContent, depth: document.getElementById('depth').textContent, l1: (document.querySelector('#lines li')||{}).textContent || ''})")
        ok = st['fen'] == fr['fen']
        if i > 0: checks.append((fr['kind'], ok))
        print(f"{i:3d} {fr['kind']:7s} {'OK ' if ok else 'BAD'} {st['fen'][:58]:58s} | {st['hist'][:40]:40s} | {st['scan'][:52]} | {st['ev']} {st['l1'][:40]}", flush=True)
        if not ok: print('      want', fr['fen'])
        if i == 30: page.screenshot(path=f'{HERE}/shot_{game}.png')
    ctx.close()
srv.shutdown()
for kind in ('settled', 'hover'):
    c = [ok for k2, ok in checks if k2 == kind]; print(kind, sum(c), '/', len(c))
for l in logs:
    if 'rror' in l: print(l[:300])
