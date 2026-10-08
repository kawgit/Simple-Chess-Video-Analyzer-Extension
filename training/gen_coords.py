"""Synthetic board-coordinate glyph patches (1-8, a-h, or none) for the
orientation reader. Patches mirror what the extension extracts:
  * corner patches: the 0.34*S x 0.34*S square in each corner of an edge square
  * outside patches: a 0.5*S x 0.5*S cell just outside the board edge
"""
import io, os, sys, random, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import gen

CHARS = '12345678abcdefgh'            # class = 1 + index; 0 = none
P = 24                                 # patch size fed to the model
CORNER = 0.34                          # corner patch fraction of the square
OUT = 0.5                              # outside patch fraction of the square

FONTS = [f for f in glob.glob('/usr/share/fonts/**/*.[ot]tf', recursive=True)
         if not any(k in f.lower() for k in ('cjk', 'math', 'symbol', 'emoji', 'italic', 'oblique', 'cursor', 'mono', 'thin', 'extralight', 'hairline'))]
_font_cache = {}
def font(path, size):
    k = (path, size)
    if k not in _font_cache:
        try: _font_cache[k] = ImageFont.truetype(path, size)
        except Exception: _font_cache[k] = None
    return _font_cache[k]

def theme(rng):
    if rng.random() < 0.6: l, d = rng.choice(gen.KNOWN_COLORS)
    else: l, d = gen.rand_colors(rng)
    return l, d

def draw_glyph(img, ch, box, rng, color, size_px):
    """Draw character ch inside box (x0,y0,x1,y1) at a random spot near `anchor`."""
    for _ in range(4):
        f = font(rng.choice(FONTS), max(5, size_px))
        if f is None: continue
        d = ImageDraw.Draw(img)
        bb = d.textbbox((0, 0), ch, font=f)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        if w <= 0 or h <= 0: continue
        x0, y0, x1, y1 = box
        if x1 - x0 < w or y1 - y0 < h: continue
        x = rng.uniform(x0, x1 - w) - bb[0]; y = rng.uniform(y0, y1 - h) - bb[1]
        d.text((x, y), ch, font=f, fill=color)
        return True
    return False

def degrade(rng, im):
    w = im.size[0]
    k = rng.uniform(0.22, 1.0)                   # simulate small boards in video
    sm = max(8, int(w * k))
    im = im.resize((sm, sm), rng.choice([Image.BILINEAR, Image.BICUBIC, Image.BOX])).resize((w, w), Image.BILINEAR)
    if rng.random() < 0.3: im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 1.0)))
    if rng.random() < 0.7:
        b = io.BytesIO(); im.save(b, 'JPEG', quality=rng.randint(25, 90)); im = Image.open(b).convert('RGB')
    if rng.random() < 0.5:
        im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.8, 1.2))
        im = ImageEnhance.Contrast(im).enhance(rng.uniform(0.75, 1.2))
    return im

def corner_sample(rng, sets, tex):
    S = 96
    l, d = theme(rng)
    light = rng.random() < 0.5
    bg, other = (l, d) if light else (d, l)
    if rng.random() < 0.2 and tex:
        t = gen.load_tex(rng.choice(tex)); tx, ty = rng.randint(0, t.size[0] - 130), rng.randint(0, t.size[1] - 130)
        sq = t.crop((tx, ty, tx + 128, ty + 128)).resize((S, S))
        other = tuple(int(255 - c * 0.6) for c in sq.resize((1, 1)).getpixel((0, 0)))
    else:
        sq = Image.new('RGB', (S, S), bg)
    # neighbouring squares around (so blur pulls in realistic edges)
    canvas = Image.new('RGB', (S * 3, S * 3), other)
    canvas.paste(sq, (S, S))
    for (cx, cy) in ((0, 0), (2, 0), (0, 2), (2, 2)):
        canvas.paste(Image.new('RGB', (S, S), bg), (cx * S, cy * S))
    if rng.random() < 0.15:   # board edge: outside page colour
        side = rng.randrange(4); g = rng.randint(0, 255); pc = (g, g, g) if rng.random() < .6 else tuple(rng.randint(0, 255) for _ in range(3))
        dr = ImageDraw.Draw(canvas)
        if side == 0: dr.rectangle([0, 0, S - 1, 3 * S], fill=pc)
        if side == 1: dr.rectangle([2 * S, 0, 3 * S, 3 * S], fill=pc)
        if side == 2: dr.rectangle([0, 0, 3 * S, S - 1], fill=pc)
        if side == 3: dr.rectangle([0, 2 * S, 3 * S, 3 * S], fill=pc)
    od = ImageDraw.Draw(canvas, 'RGBA')
    if rng.random() < 0.25:   # highlight tint
        col = rng.choice(gen.HL_COLORS); od.rectangle([S, S, 2 * S - 1, 2 * S - 1], fill=col + (rng.randint(60, 200),))
    if rng.random() < 0.55:   # a piece on the square
        p = gen.load_piece(rng.choice(sets), rng.choice('wb') + rng.choice('KQRBNP'))
        ps = int(S * rng.uniform(0.8, 1.0)); p = p.resize((ps, ps), Image.LANCZOS)
        canvas.paste(p, (S + (S - ps) // 2 + rng.randint(-3, 3), S + (S - ps) // 2 + rng.randint(-3, 3)), p)
    if rng.random() < 0.1:    # move dot / ring
        c = (0, 0, 0, rng.randint(30, 90)); r = S * rng.uniform(0.12, 0.2)
        od.ellipse([1.5 * S - r, 1.5 * S - r, 1.5 * S + r, 1.5 * S + r], fill=c)
    if rng.random() < 0.1:    # arrow segment through the square
        col = rng.choice(gen.ARROW_COLORS) + (rng.randint(120, 220),)
        a = rng.uniform(0, 3.14); cx, cy = 1.5 * S, 1.5 * S; L = S * 1.5
        od.line([(cx - L * np.cos(a), cy - L * np.sin(a)), (cx + L * np.cos(a), cy + L * np.sin(a))], fill=col, width=int(S * 0.15))
    corner = rng.randrange(4)                     # 0 TL, 1 TR, 2 BL, 3 BR
    cls = 0
    if rng.random() < 0.72:
        cls = 1 + rng.randrange(16)
        ch = CHARS[cls - 1]
        r = rng.random()
        if r < 0.55: col = other
        elif r < 0.75: col = (255, 255, 255) if rng.random() < .5 else (20, 20, 20)
        else: col = tuple(rng.randint(0, 255) for _ in range(3))
        sz = int(S * rng.uniform(0.11, 0.30))
        m = S * rng.uniform(0.01, 0.10)
        cw = S * CORNER
        x0 = S + (m if corner in (0, 2) else S - cw)
        y0 = S + (m if corner in (0, 1) else S - cw)
        box = (x0, y0, x0 + cw - m, y0 + cw - m)
        if not draw_glyph(canvas, ch, box, rng, col, sz): cls = 0
    canvas = degrade(rng, canvas)
    cw = S * CORNER
    x0 = S + (0 if corner in (0, 2) else S - cw); y0 = S + (0 if corner in (0, 1) else S - cw)
    return canvas.crop((int(x0), int(y0), int(x0 + cw), int(y0 + cw))).resize((P, P), Image.BILINEAR), cls

def outside_sample(rng):
    S = 96; cw = int(S * OUT)
    r = rng.random()
    if r < 0.45: g = rng.randint(0, 60); bg = (g, g, g + rng.randint(0, 8))
    elif r < 0.7: g = rng.randint(200, 255); bg = (g, g, g)
    else: bg = tuple(rng.randint(0, 255) for _ in range(3))
    canvas = Image.new('RGB', (cw * 3, cw * 3), bg)
    if rng.random() < 0.3:   # board edge visible next to the cell
        l, d = theme(rng); dr = ImageDraw.Draw(canvas)
        side = rng.randrange(4); c = l if rng.random() < .5 else d
        if side == 0: dr.rectangle([0, 0, cw * 0.9, cw * 3], fill=c)
        if side == 1: dr.rectangle([cw * 2.1, 0, cw * 3, cw * 3], fill=c)
        if side == 2: dr.rectangle([0, 0, cw * 3, cw * 0.9], fill=c)
        if side == 3: dr.rectangle([0, cw * 2.1, cw * 3, cw * 3], fill=c)
    cls = 0
    if rng.random() < 0.7:
        cls = 1 + rng.randrange(16)
        lum = sum(bg) / 3
        col = (235, 235, 235) if lum < 128 else (40, 40, 40)
        if rng.random() < 0.25: col = tuple(rng.randint(0, 255) for _ in range(3))
        sz = int(cw * rng.uniform(0.3, 0.75)); j = cw * 0.18
        box = (cw + rng.uniform(-j, j * .2), cw + rng.uniform(-j, j * .2), 2 * cw + rng.uniform(-j * .2, j), 2 * cw + rng.uniform(-j * .2, j))
        if not draw_glyph(canvas, CHARS[cls - 1], box, rng, col, sz): cls = 0
    canvas = degrade(rng, canvas)
    return canvas.crop((cw, cw, 2 * cw, 2 * cw)).resize((P, P), Image.BILINEAR), cls

def build(n, seed, out):
    rng = random.Random(seed)
    sets, tex = gen.piece_sets(), gen.board_textures()
    X = np.zeros((n, P, P, 3), np.uint8); Y = np.zeros(n, np.int64)
    for i in range(n):
        im, c = corner_sample(rng, sets, tex) if rng.random() < 0.78 else outside_sample(rng)
        X[i] = np.asarray(im); Y[i] = c
        if i % 20000 == 0: print(out, i, flush=True)
    np.savez(out, X=X, Y=Y)

if __name__ == '__main__':
    if sys.argv[1] == 'preview':
        rng = random.Random(int(sys.argv[2])); sets, tex = gen.piece_sets(), gen.board_textures()
        S = Image.new('RGB', (P * 4 * 16, P * 4 * 6)); d = ImageDraw.Draw(S)
        for k in range(96):
            im, c = corner_sample(rng, sets, tex) if k < 72 else outside_sample(rng)
            S.paste(im.resize((P * 4, P * 4), Image.NEAREST), ((k % 16) * P * 4, (k // 16) * P * 4))
            d.text(((k % 16) * P * 4 + 2, (k // 16) * P * 4 + 2), '-' if c == 0 else CHARS[c - 1], fill=(255, 0, 255))
        S.save(os.path.join(os.path.dirname(__file__), 'coord_preview.png'))
    else:
        build(int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
