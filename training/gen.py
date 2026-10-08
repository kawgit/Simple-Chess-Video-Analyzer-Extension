"""Synthetic chessboard generator for training a square classifier that is
robust to arrows, circles, square highlights, move dots, coordinates, cursor,
video compression and an imprecise board box."""
import io, math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

ROOT = os.path.dirname(os.path.abspath(__file__))
PIECES = 'KQRBNP'
# class ids: 0 empty, 1..6 white K Q R B N P, 7..12 black K Q R B N P
SQ = 32          # model input size per square
BOARD = SQ * 8   # canonical board size

_piece_cache, _board_cache = {}, {}
LAST_THEME = None

def piece_sets():
    return sorted(os.listdir(f'{ROOT}/pieces'))

def board_textures():
    return sorted(os.listdir(f'{ROOT}/boards'))

def load_piece(s, name):
    k = (s, name)
    if k not in _piece_cache:
        _piece_cache[k] = Image.open(f'{ROOT}/pieces/{s}/{name}.png').convert('RGBA')
    return _piece_cache[k]

def load_tex(t):
    if t not in _board_cache:
        _board_cache[t] = Image.open(f'{ROOT}/boards/{t}').convert('RGB')
    return _board_cache[t]

KNOWN_COLORS = [
    ((238, 238, 210), (118, 150, 86)),   # green
    ((240, 217, 181), (181, 136, 99)),   # brown
    ((222, 227, 230), (140, 162, 173)),  # blue
    ((234, 233, 210), (75, 115, 153)),   # dark blue
    ((235, 236, 208), (115, 149, 82)),
    ((255, 255, 255), (200, 200, 200)),  # print-like
    ((232, 235, 239), (125, 135, 150)),  # slate
    ((240, 241, 240), (196, 216, 228)),  # icy
    ((237, 214, 176), (184, 135, 98)),
    ((227, 193, 111), (184, 139, 74)),
    ((240, 240, 240), (140, 140, 140)),
]

def rand_colors(rng):
    if rng.random() < 0.55:
        l, d = rng.choice(KNOWN_COLORS)
    else:
        import colorsys
        h = rng.random(); s = rng.uniform(0.05, 0.6)
        l = tuple(int(255 * c) for c in colorsys.hsv_to_rgb(h, s * 0.4, rng.uniform(0.82, 1.0)))
        d = tuple(int(255 * c) for c in colorsys.hsv_to_rgb(h + rng.uniform(-.05, .05), s, rng.uniform(0.35, 0.75)))
    if rng.random() < 0.08:  # rarely swapped/low contrast
        l, d = d, l
    return l, d

ARROW_COLORS = [
    (21, 120, 27), (136, 32, 32), (0, 48, 136), (230, 143, 0),
    (255, 170, 0), (159, 207, 63), (248, 85, 63), (72, 193, 249), (154, 30, 200),
]
HL_COLORS = [
    (255, 255, 51), (205, 210, 106), (170, 162, 58), (155, 199, 0), (20, 85, 30),
    (247, 247, 105), (187, 203, 43), (235, 97, 80), (100, 160, 255), (255, 170, 0),
]

def rand_position(rng):
    """board[r][f] class ids, r=0 is top row of the image."""
    p_empty = rng.uniform(0.25, 0.85)
    w = np.array([1, 1.5, 2, 2, 2, 5.0]); w = w / w.sum()
    b = np.zeros((8, 8), np.int64)
    for r in range(8):
        for f in range(8):
            if rng.random() < p_empty: continue
            kind = rng.choices(range(6), weights=w)[0]
            if kind == 5 and r in (0, 7) and rng.random() < 0.8:
                kind = rng.choice([1, 2, 3, 4])
            b[r, f] = 1 + kind + (6 if rng.random() < 0.5 else 0)
    return b

def font(size):
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()

def draw_arrow(dr, a, b, width, color, head=True, knight=False):
    (x0, y0), (x1, y1) = a, b
    pts = [(x0, y0)]
    if knight:
        if abs(x1 - x0) > abs(y1 - y0): pts.append((x1, y0))
        else: pts.append((x0, y1))
    pts.append((x1, y1))
    # shorten end for head
    px, py = pts[-2]
    L = math.hypot(x1 - px, y1 - py) + 1e-6
    ux, uy = (x1 - px) / L, (y1 - py) / L
    hl = width * 2.0
    end = (x1 - ux * hl * 0.9, y1 - uy * hl * 0.9) if head else (x1, y1)
    line = pts[:-1] + [end]
    for i in range(len(line) - 1):
        dr.line([line[i], line[i + 1]], fill=color, width=int(width))
    if knight:
        r = width / 2
        dr.ellipse([pts[1][0] - r, pts[1][1] - r, pts[1][0] + r, pts[1][1] + r], fill=color)
    if head:
        nx, ny = -uy, ux
        hw = width * 1.6
        bx, by = x1 - ux * hl, y1 - uy * hl
        dr.polygon([(x1, y1), (bx + nx * hw, by + ny * hw), (bx - nx * hw, by - ny * hw)], fill=color)

def render(rng, sets_allowed, tex_allowed, pos=None, s=None, highlights=None, colors=None, extra=None, coords=True):
    s = s or rng.randint(32, 72)            # square size px at render time
    S = 8 * s
    M = s                                    # margin around board
    W = S + 2 * M
    # background around board
    bg_kind = rng.random()
    if bg_kind < 0.4:
        g = rng.randint(10, 80); bgc = (g, g, g + rng.randint(0, 10))
    elif bg_kind < 0.7:
        bgc = tuple(rng.randint(0, 255) for _ in range(3))
    else:
        g = rng.randint(180, 255); bgc = (g, g, g)
    img = Image.new('RGB', (W, W), bgc)
    if rng.random() < 0.3:  # noisy / gradient background
        arr = np.array(img).astype(np.float32)
        arr += np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(5, 40), arr.shape)
        img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    # board
    if colors is None and rng.random() < 0.4 and tex_allowed:
        tex = load_tex(rng.choice(tex_allowed)).resize((S, S), Image.BILINEAR)
        if rng.random() < 0.5: tex = tex.transpose(Image.FLIP_LEFT_RIGHT)  # orientation variety
        board = tex
        global LAST_THEME; LAST_THEME = 'texture'
    else:
        l, d = colors if colors else rand_colors(rng)
        LAST_THEME = 'known' if (l, d) in KNOWN_COLORS or (d, l) in KNOWN_COLORS else 'random'
        board = Image.new('RGB', (S, S), l)
        bd = ImageDraw.Draw(board)
        hatch = rng.random() < 0.05 and colors is None
        if hatch: LAST_THEME = 'hatch'
        for r in range(8):
            for f in range(8):
                if (r + f) % 2 == 1:
                    x, y = f * s, r * s
                    if hatch:
                        for k in range(-s, s, max(3, s // 8)):
                            bd.line([(x + k, y), (x + k + s, y + s)], fill=d, width=1)
                    else:
                        bd.rectangle([x, y, x + s - 1, y + s - 1], fill=d)
    img.paste(board, (M, M))
    if rng.random() < 0.3 and colors is None:  # board border
        ImageDraw.Draw(img).rectangle([M - 3, M - 3, M + S + 2, M + S + 2], outline=tuple(rng.randint(0, 255) for _ in range(3)), width=rng.randint(1, 4))
    pos = rand_position(rng) if pos is None else pos

    # --- under-piece layer: highlights (supersample 2x)
    SS = 2
    over = Image.new('RGBA', (W * SS, W * SS), (0, 0, 0, 0))
    od = ImageDraw.Draw(over)
    def sqbox(r, f, inset=0):
        x, y = (M + f * s) * SS, (M + r * s) * SS
        return [x + inset, y + inset, x + s * SS - 1 - inset, y + s * SS - 1 - inset]
    def sqc(r, f):
        return ((M + f * s + s / 2) * SS, (M + r * s + s / 2) * SS)
    if highlights is not None:
        for h in highlights:
            for (r, f) in h['squares']:
                if h.get('style') == 'outline':
                    od.rectangle(sqbox(r, f, 0), outline=h['color'] + (h['alpha'],), width=int(s * SS * 0.08))
                else:
                    od.rectangle(sqbox(r, f), fill=h['color'] + (h['alpha'],))
    nhl = rng.choice([0, 0, 1, 2, 2, 2, 3, 4, 6, 10]) if highlights is None else 0
    hlcol = rng.choice(HL_COLORS)
    for _ in range(nhl):
        col = hlcol if rng.random() < 0.7 else rng.choice(HL_COLORS)
        a = rng.randint(70, 210)
        r, f = rng.randrange(8), rng.randrange(8)
        if rng.random() < 0.15:  # outline style highlight
            od.rectangle(sqbox(r, f, 0), outline=col + (a,), width=int(s * SS * rng.uniform(0.05, 0.12)))
        else:
            od.rectangle(sqbox(r, f), fill=col + (a,))
    if rng.random() < 0.15 and colors is None:  # check glow on a king
        ks = [(r, f) for r in range(8) for f in range(8) if pos[r, f] in (1, 7)]
        if ks:
            r, f = rng.choice(ks)
            cx, cy = sqc(r, f)
            for k in range(12, 0, -1):
                rad = s * SS * 0.55 * k / 12
                od.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(255, 0, 0, int(25 + 10 * (12 - k))))
    over = over.resize((W, W), Image.LANCZOS)
    img = Image.alpha_composite(img.convert('RGBA'), over)

    # coordinates
    if rng.random() < 0.6 and coords:
        cd = ImageDraw.Draw(img)
        fnt = font(max(7, int(s * rng.uniform(0.18, 0.32))))
        col = rng.choice([(255, 255, 255), (0, 0, 0), (120, 120, 120), (240, 217, 181), (181, 136, 99)])
        files = 'abcdefgh' if rng.random() < .5 else 'hgfedcba'
        ranks = '87654321' if files[0] == 'a' else '12345678'
        for i in range(8):
            cd.text((M + i * s + s - s * 0.22, M + S - s * 0.3), files[i], fill=col, font=fnt)
            cd.text((M + s * 0.05, M + i * s + s * 0.02), ranks[i], fill=col, font=fnt)

    # pieces
    pset = rng.choice(sets_allowed)
    pscale_base = rng.uniform(0.78, 1.0) if colors is None else 0.9
    # per-board piece styling so unseen sets look less surprising
    tint = {}
    for col in 'wb':
        if rng.random() < 0.5 and colors is None:
            g = np.array([rng.uniform(0.8, 1.15) for _ in range(3)], np.float32)
            o = rng.uniform(-25, 25)
            tint[col] = (g, o)
    pblur = rng.uniform(0.3, 0.9) if rng.random() < 0.2 and colors is None else 0
    for r in range(8):
        for f in range(8):
            c = pos[r, f]
            if not c: continue
            name = ('w' if c <= 6 else 'b') + PIECES[(c - 1) % 6]
            pim = load_piece(pset, name)
            ps = max(8, int(s * pscale_base * (rng.uniform(0.97, 1.03) if colors is None else 1)))
            pim = pim.resize((ps, ps), Image.LANCZOS)
            if name[0] in tint:
                g, o = tint[name[0]]
                a = np.asarray(pim).astype(np.float32)
                a[..., :3] = (a[..., :3] * g + o).clip(0, 255)
                pim = Image.fromarray(a.astype(np.uint8), 'RGBA')
            if pblur:
                pim = pim.filter(ImageFilter.GaussianBlur(pblur))
            jit = 0.03 if colors is None else 0
            ox = int(M + f * s + (s - ps) / 2 + rng.uniform(-jit, jit) * s)
            oy = int(M + r * s + (s - ps) / 2 + rng.uniform(-jit, jit) * s)
            img.alpha_composite(pim, (ox, oy))

    # --- over-piece layer: arrows, circles, move dots, cursor
    over = Image.new('RGBA', (W * SS, W * SS), (0, 0, 0, 0))
    od = ImageDraw.Draw(over)
    if rng.random() < 0.25:  # legal move dots / capture rings
        dc = rng.choice([(0, 0, 0, 40), (20, 85, 30, 120), (0, 0, 0, 60), (80, 80, 80, 90)])
        for _ in range(rng.randint(1, 10)):
            r, f = rng.randrange(8), rng.randrange(8)
            cx, cy = sqc(r, f)
            if pos[r, f]:
                rad = s * SS * 0.48
                od.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=dc, width=int(s * SS * 0.08))
            else:
                rad = s * SS * rng.uniform(0.12, 0.2)
                od.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=dc)
    narrow = rng.choice([0, 0, 1, 1, 2, 2, 3, 4, 5, 7])
    style_alpha = rng.randint(110, 230)
    style_w = rng.uniform(0.1, 0.24)
    for _ in range(narrow):
        col = rng.choice(ARROW_COLORS) + (style_alpha,)
        r0, f0 = rng.randrange(8), rng.randrange(8)
        if rng.random() < 0.2:
            dr_, df_ = rng.choice([(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)])
            knight = True
        else:
            dr_, df_ = rng.randint(-7, 7), rng.randint(-7, 7)
            if rng.random() < 0.6:  # straight / diagonal lines are common
                k = rng.randint(1, 7)
                dr_, df_ = rng.choice([(k, 0), (0, k), (k, k), (k, -k), (-k, 0), (0, -k), (-k, k), (-k, -k)])
            knight = False
        r1, f1 = r0 + dr_, f0 + df_
        if not (0 <= r1 < 8 and 0 <= f1 < 8) or (r1, f1) == (r0, f0): continue
        draw_arrow(od, sqc(r0, f0), sqc(r1, f1), s * SS * style_w, col, head=True, knight=knight)
    for _ in range(rng.choice([0, 0, 0, 1, 2, 3])):
        col = rng.choice(ARROW_COLORS) + (style_alpha,)
        cx, cy = sqc(rng.randrange(8), rng.randrange(8))
        rad = s * SS * rng.uniform(0.42, 0.5)
        od.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=col, width=int(s * SS * rng.uniform(0.06, 0.1)))
    if rng.random() < 0.25:  # mouse cursor
        x, y = rng.uniform(M, M + S) * SS, rng.uniform(M, M + S) * SS
        k = s * SS * rng.uniform(0.25, 0.5)
        poly = [(x, y), (x, y + k), (x + k * .28, y + k * .75), (x + k * .5, y + k * 1.1), (x + k * .6, y + k), (x + k * .42, y + k * .68), (x + k * .72, y + k * .68)]
        od.polygon(poly, fill=(255, 255, 255, 255), outline=(0, 0, 0, 255))
    over = over.resize((W, W), Image.LANCZOS)
    img = Image.alpha_composite(img, over).convert('RGB')
    if extra: extra(img, M, s)
    return img, pos, M, s

def degrade(rng, img, M, s):
    """Simulate video: downscale, blur, jpeg, colour shifts. Return image + new geometry."""
    W = img.size[0]
    target_sq = rng.uniform(13, 55)  # square size in the video frame
    global LAST_SQ; LAST_SQ = target_sq
    k = target_sq / s
    nw = max(64, int(W * k))
    img = img.resize((nw, nw), rng.choice([Image.BILINEAR, Image.BICUBIC, Image.LANCZOS, Image.BOX]))
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    if rng.random() < 0.8:
        b = io.BytesIO(); img.save(b, 'JPEG', quality=rng.randint(20, 92)); img = Image.open(b).convert('RGB')
    if rng.random() < 0.5:
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.75, 1.25))
        img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.75, 1.25))
        img = ImageEnhance.Color(img).enhance(rng.uniform(0.6, 1.4))
    global LAST_GRAY; LAST_GRAY = False
    if rng.random() < 0.04:
        img = img.convert('L').convert('RGB'); LAST_GRAY = True
    return img, M * nw / W, s * nw / W

def sample_board(rng, sets_allowed, tex_allowed, box_err=0.08, pos=None, highlights=None):
    img, pos, M, s = render(rng, sets_allowed, tex_allowed, pos=pos, highlights=highlights)
    img, M, s = degrade(rng, img, M, s)
    S = 8 * s
    # imprecise selection box
    dx, dy = rng.uniform(-box_err, box_err) * s, rng.uniform(-box_err, box_err) * s
    sc = 1 + rng.uniform(-0.25, 0.25) * box_err
    x0, y0 = M + dx, M + dy
    Sb = S * sc
    crop = img.transform((BOARD, BOARD), Image.EXTENT, (x0, y0, x0 + Sb, y0 + Sb),
                         rng.choice([Image.BILINEAR, Image.BICUBIC]))
    return np.asarray(crop), pos

def squares(board_arr):
    a = board_arr.reshape(8, SQ, 8, SQ, 3).transpose(0, 2, 1, 3, 4)
    return a.reshape(64, SQ, SQ, 3)

def build(n, seed, sets_allowed, tex_allowed, out):
    rng = random.Random(seed)
    X = np.zeros((n * 64, SQ, SQ, 3), np.uint8)
    Y = np.zeros((n * 64,), np.int64)
    for i in range(n):
        b, pos = sample_board(rng, sets_allowed, tex_allowed)
        X[i * 64:(i + 1) * 64] = squares(b)
        Y[i * 64:(i + 1) * 64] = pos.reshape(-1)
        if i % 500 == 0: print(out, i, flush=True)
    np.savez(out, X=X, Y=Y)

if __name__ == '__main__':
    mode = sys.argv[1]
    sets = piece_sets(); tex = board_textures()
    HOLD_SETS = ['staunty', 'maestro', 'pixel']
    HOLD_TEX = ['wood3.jpg', 'blue-marble.jpg']
    if mode == 'preview':
        rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
        tiles = [Image.fromarray(sample_board(rng, sets, tex)[0]) for _ in range(6)]
        sheet = Image.new('RGB', (BOARD * 3, BOARD * 2))
        for i, t in enumerate(tiles): sheet.paste(t, ((i % 3) * BOARD, (i // 3) * BOARD))
        sheet.save(f'{ROOT}/preview.png')
    elif mode == 'holdout_train':
        n, seed = int(sys.argv[2]), int(sys.argv[3])
        build(n, seed, [s for s in sets if s not in HOLD_SETS], [t for t in tex if t not in HOLD_TEX], sys.argv[4])
    elif mode == 'holdout_test':
        n, seed = int(sys.argv[2]), int(sys.argv[3])
        build(n, seed, HOLD_SETS, HOLD_TEX, sys.argv[4])
    elif mode == 'full':
        n, seed = int(sys.argv[2]), int(sys.argv[3])
        build(n, seed, [s for s in sets if s not in ('staunty', 'maestro')], tex, sys.argv[4])
