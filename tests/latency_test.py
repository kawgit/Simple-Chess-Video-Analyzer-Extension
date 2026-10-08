import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
import json, shutil, time, threading, http.server, functools, sys, statistics
from playwright.sync_api import sync_playwright
EXT_SRC, EXT = sys.argv[1], f'{HERE}/ext_test'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(EXT_SRC, EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] = ['<all_urls>']; json.dump(m, open(f'{EXT}/manifest.json', 'w'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Q, directory=f'{HERE}/site'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
t = json.load(open(f'{HERE}/site/game3/truth.json'))
fr = t['frames']
moves = [i for i in range(1, len(fr)) if fr[i]['kind'] == 'anim']
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.gettempdir() + '/lca-pwl-%d' % time.time(), headless=True, channel='chromium',
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
    page.evaluate(f'window.__set({moves[0] + 1})'); page.wait_for_timeout(3000)
    # install a watcher in the panel that records when #fen and #evalNum change
    panel.evaluate("""() => { window.__log = []; const f = document.getElementById('fen'), e = document.getElementById('evalNum');
        new MutationObserver(() => window.__log.push(['fen', performance.now() + performance.timeOrigin, f.textContent])).observe(f, {childList: true, characterData: true, subtree: true});
        new MutationObserver(() => window.__log.push(['eval', performance.now() + performance.timeOrigin, e.textContent])).observe(e, {childList: true, characterData: true, subtree: true}); }""")
    panel.evaluate("() => { window.__dbg = []; }")
    lat, evlat = [], []
    for i in moves[1:16]:
        panel.evaluate("() => { window.__log = []; window.__dbg = []; }")
        t0 = page.evaluate(f'() => {{ window.__set({i}); return performance.now() + performance.timeOrigin; }}')   # animation frame
        page.wait_for_timeout(150)
        page.evaluate(f'window.__set({i + 1})')    # settled
        page.wait_for_timeout(2500)
        log = panel.evaluate("() => window.__log")
        want = fr[i]['fen']
        hit = next((x for x in log if x[0] == 'fen' and x[2] == want), None)
        ev = next((x for x in log if x[0] == 'eval' and hit and x[1] >= hit[1] - 1 and x[2] not in ('–', '')), None)
        dbg = panel.evaluate("() => window.__dbg")
        if len(sys.argv) > 2: print('   ', [(round(d[4] - t0), round(d[0] - t0), d[1], d[3], 'worker', d[5], 'sq', d[6], 'upd', d[7]) for d in dbg[:3]])
        if hit: lat.append(hit[1] - t0)
        if ev: evlat.append(ev[1] - t0)
        print(f"{fr[i]['fen'][:36]:36s} fen {'%5.0f' % (hit[1] - t0) if hit else ' MISS'} ms   eval {'%5.0f' % (ev[1] - t0) if ev else '  -  '} ms  {ev[2] if ev else ''}", flush=True)
    print('median position latency %.0f ms, median eval latency %.0f ms' % (statistics.median(lat), statistics.median(evlat)))
    ctx.close()
srv.shutdown()
