import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
import json, shutil, time, threading, http.server, functools
from playwright.sync_api import sync_playwright
EXT_SRC, EXT = os.path.join(ROOT, 'extension'), f'{HERE}/ext_test'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(EXT_SRC, EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] = ['<all_urls>']; json.dump(m, open(f'{EXT}/manifest.json', 'w'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Q, directory=f'{HERE}/site'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
t = json.load(open(f'{HERE}/site/game3/truth.json'))
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.gettempdir() + '/lca-pwr2-%d' % time.time(), headless=True, channel='chromium',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    page = ctx.new_page(); page.goto('http://127.0.0.1:8765/index.html?game=game3'); page.wait_for_function('window.__ready === true'); page.wait_for_timeout(1000)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    sw.evaluate("""async () => { const tab = (await chrome.tabs.query({})).find(t => /8765/.test(t.url || ''));
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['guard.js', 'snap.js', 'content.js']}); }""")
    panel = None
    for _ in range(200):
        panel = next((f for f in page.frames if 'panel.html' in f.url), None)
        if panel: break
        page.wait_for_timeout(100)
    page.wait_for_timeout(2000)
    bx, by, bs = t['box']; k = 0.75; x0, y0, size = 64 + bx * k, 38 + by * k, bs * k + 6
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 + size, y0 + size, steps=8); page.mouse.up()
    page.evaluate('window.__set(2)')
    def rate(hz):
        panel.evaluate(f"() => {{ const r = document.getElementById('rate'); r.value = {hz}; r.dispatchEvent(new Event('input')); }}")
    def perf(): return panel.evaluate("() => document.getElementById('perf').textContent")
    for hz in (5, 15, 30):
        rate(hz); page.wait_for_timeout(3000); print(f'cap {hz:2d} Hz, video 20 fps:', perf())
    page.evaluate('window.__frozen = true'); page.wait_for_timeout(3000); print('paused video:', repr(perf()), panel.evaluate("() => document.getElementById('fen').textContent")[:40])
    page.evaluate('window.__set(6); window.__frozen = false'); page.wait_for_timeout(60); page.evaluate('window.__frozen = true')
    page.wait_for_timeout(1500); print('seek while paused, fen:', panel.evaluate("() => document.getElementById('fen').textContent")[:40], '| want', t['frames'][6]['fen'][:40])
    page.evaluate('window.__frozen = false'); page.wait_for_timeout(2500); print('playing again:', perf())
    ctx.close()
srv.shutdown()
