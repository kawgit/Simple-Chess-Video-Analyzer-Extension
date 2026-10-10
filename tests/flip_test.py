"""Game A (white at bottom, labels) then game B (black at bottom). Measures how
long the panel takes to switch orientation and get B's positions right."""
import json, shutil, sys, time, threading, http.server, functools
from playwright.sync_api import sync_playwright
EXT_SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/ext'; EXT = '/home/claude/e2e/ext_flip'
NOCOORDS = len(sys.argv) > 2 and sys.argv[2] == 'nocoords'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(EXT_SRC, EXT)
if NOCOORDS:
    import os; os.remove(EXT + '/model/orient.onnx')
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] = ['<all_urls>']; json.dump(m, open(f'{EXT}/manifest.json', 'w'))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Quiet, directory='/home/claude/e2e/site'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
truth = json.load(open('/home/claude/e2e/site/flip/truth.json'))
HOLD = {'anim': 0.15, 'settled': 1.6, 'hover': 1.0}
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context('/tmp/claude-0/pwf-%d' % time.time(), headless=True, channel='chromium',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1280, 'height': 800})
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8765/index.html?game=flip&fps=30'); page.wait_for_function('window.__ready === true'); page.wait_for_timeout(1000)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    sw.evaluate("""async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url||t.pendingUrl||'').includes('127.0.0.1'));
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['guard.js', 'snap.js', 'content.js']}); }""")
    page.wait_for_timeout(2500)
    bx, by, bs = truth['box']; k = 0.75
    x0, y0, size = 60 + bx * k + 6, 40 + by * k - 3.6, bs * k + 7.8
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 + size, y0 + size, steps=8); page.mouse.up()
    panel = None
    while not panel:
        panel = next((f for f in page.frames if 'panel.html' in f.url), None); page.wait_for_timeout(100)
    page.wait_for_timeout(1500)
    rd = lambda: panel.evaluate("() => ({fen: document.getElementById('fen').textContent, auto: (document.getElementById('autoSide')||{}).textContent || '', cms: window.__coordMs, scan: document.getElementById('scanInfo').textContent})")
    tB = None; tBlack = None; firstOk = None; okA = okB = nA = nB = 0
    for i, fr in enumerate(truth['frames']):
        page.evaluate(f'window.__set({i})'); t0 = time.time()
        if fr['game'] == 'b' and tB is None: tB = t0
        ok = False
        while time.time() - t0 < HOLD[fr['kind']]:
            st = rd()
            if fr['game'] == 'b' and tBlack is None and 'Black' in st['auto']: tBlack = time.time() - tB
            if st['fen'] == fr['fen'] and fr['game'] == 'b' and firstOk is None and i > [j for j, f in enumerate(truth['frames']) if f['game'] == 'b'][0]: firstOk = (time.time() - tB, i)
            page.wait_for_timeout(40)
        st = rd(); ok = st['fen'] == fr['fen']
        if fr['kind'] == 'settled':
            if fr['game'] == 'a': nA += 1; okA += ok
            else: nB += 1; okB += ok
        if fr['kind'] != 'anim' and (fr['game'] == 'b' or not ok): print(f"{i:3d} {fr['game']} {fr['kind']:7s} {'OK ' if ok else 'BAD'} {st['auto']:8s} {st['fen'][:50]:50s} | {st['scan'][-80:]}", flush=True)
    cms = rd()['cms']
    ctx.close()
srv.shutdown()
print('label reader ms:', cms)
print(f'game A settled {okA}/{nA} · game B settled {okB}/{nB} · Auto showed Black after {tBlack if tBlack is None else round(tBlack, 2)} s · first correct B position after {firstOk}')
