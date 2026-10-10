"""Whole-board orientation data: the extension's coordinate frame (board + half a
square of margin, 576x576, 64 px squares) reduced to its four edge strips, with
a 3-way target: 0 = no readable labels, 1 = white at the bottom, 2 = black.

Strips (grayscale, 96 x 512 each, outermost row first, rotated not mirrored):
  top, bottom, left, right  (see strips())
"""
import io, os, sys, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import gen
from gen_coords import FONTS, font

F = 576; SQ = 64; MG = 32; D = MG + SQ           # frame, square, margin, strip depth

def to_gray(a):                                  # same weights as the ONNX model
    a = a.astype(np.float32)
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114

def strips(g):
    top = g[0:D, MG:F - MG]
    bottom = g[F - D:F, MG:F - MG][::-1, ::-1]
    left = np.rot90(g[MG:F - MG, 0:D], k=-1)
    right = np.rot90(g[MG:F - MG, F - D:F], k=1)
    return np.stack([top, bottom, left, right])

def sample_color(img, x, y):
    return img.getpixel((int(x), int(y)))[:3]

CH = '12345678abcdefgh'
def strip_pos(edge, k):                       # (strip index, position along it) for square k on an edge
    return {'t': (0, k), 'b': (1, 7 - k), 'l': (2, 7 - k), 'r': (3, k)}[edge]

def draw_labels(rng, img, M, s, wb, cfg, glyphs):
    d = ImageDraw.Draw(img)
    ranks = '87654321' if wb else '12345678'
    files = 'abcdefgh' if wb else 'hgfedcba'
    fpath = cfg['font']
    size = max(5, int(s * cfg['size']))
    f = font(fpath, size)
    if f is None: return 0, 0.0
    upper = cfg['upper']

    def col_for(r, c):                            # label colour on square (r, c)
        mode = cfg['color']
        if mode == 'alt':                         # the other square colour (chess.com / lichess)
            rr, cc = (r, c + 1) if c < 7 else (r, c - 1)
            return sample_color(img, M + cc * s + 2, M + rr * s + 2)
        return mode

    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    contrasts = []
    def put(ch, box_x0, box_y0, w, h, ax, ay, color):
        bb = d.textbbox((0, 0), ch, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        x = box_x0 + (w - tw) * ax - bb[0]; y = box_y0 + (h - th) * ay - bb[1]
        cx = min(max(x + bb[0] + tw / 2, 0), img.size[0] - 1); cy = min(max(y + bb[1] - 1, 0), img.size[1] - 1)
        contrasts.append(abs(lum(color) - lum(sample_color(img, cx, cy))))   # vs the background just above it
        d.text((x, y), ch, font=f, fill=color)

    pad = s * cfg['pad']
    if cfg['where'] == 'inside':
        for side in cfg['rank_sides']:            # 'l' / 'r'
            c = 0 if side == 'l' else 7
            ax = (0 if side == 'l' else 1) if cfg['rank_outer'] else (1 if side == 'l' else 0)
            ay = 0 if cfg['rank_top'] else 1
            for r in range(8):
                put(ranks[r], M + c * s + pad, M + r * s + pad, s - 2 * pad, s - 2 * pad, ax, ay, col_for(r, c))
                si, j = strip_pos(side, r); glyphs[si, j] = 1 + CH.index(ranks[r])
        for side in cfg['file_sides']:            # 'b' / 't'
            r = 7 if side == 'b' else 0
            ay = (1 if side == 'b' else 0) if cfg['file_outer'] else (0 if side == 'b' else 1)
            ax = 1 if cfg['file_right'] else 0
            for c in range(8):
                ch = files[c].upper() if upper else files[c]
                put(ch, M + c * s + pad, M + r * s + pad, s - 2 * pad, s - 2 * pad, ax, ay, col_for(r, c))
                si, j = strip_pos(side, c); glyphs[si, j] = 1 + CH.index(files[c])
    else:                                         # outside the board, in the margin
        color = cfg['color'] if cfg['color'] != 'alt' else (220, 220, 220)
        gap = s * cfg['gap']
        for side in cfg['rank_sides']:
            for r in range(8):
                x0 = M - gap - s * 0.4 if side == 'l' else M + 8 * s + gap
                put(ranks[r], x0, M + r * s, s * 0.4, s, 0.5, 0.5, color)
                si, j = strip_pos(side, r); glyphs[si, j] = 1 + CH.index(ranks[r])
        for side in cfg['file_sides']:
            for c in range(8):
                y0 = M + 8 * s + gap if side == 'b' else M - gap - s * 0.4
                ch = files[c].upper() if upper else files[c]
                put(ch, M + c * s, y0, s, s * 0.4, 0.5, 0.5, color)
                si, j = strip_pos(side, c); glyphs[si, j] = 1 + CH.index(files[c])
    return size, (float(np.median(contrasts)) if contrasts else 0.0)

def label_cfg(rng):
    where = 'inside' if rng.random() < 0.72 else 'outside'
    r = rng.random()
    if r < 0.12: rank_sides, file_sides = [], ['b' if rng.random() < .85 else 't']
    elif r < 0.24: rank_sides, file_sides = [rng.choice('lr')], []
    else:
        rank_sides = [rng.choice('lr')] if rng.random() < .85 else ['l', 'r']
        file_sides = ['b'] if rng.random() < .85 else (['t'] if rng.random() < .5 else ['b', 't'])
    cr = rng.random()
    if where == 'inside':
        color = 'alt' if cr < 0.6 else rng.choice([(255, 255, 255), (20, 20, 20), (128, 128, 128), tuple(rng.randint(0, 255) for _ in range(3))])
        size = rng.uniform(0.12, 0.30)
    else:
        color = rng.choice([(230, 230, 230), (200, 200, 200), (40, 40, 40), (120, 120, 120), tuple(rng.randint(0, 255) for _ in range(3))])
        size = rng.uniform(0.18, 0.38)
    return dict(where=where, rank_sides=rank_sides, file_sides=file_sides, color=color, size=size,
                pad=rng.uniform(0.02, 0.09), gap=rng.uniform(0.0, 0.08), font=rng.choice(FONTS),
                rank_outer=rng.random() < 0.85, rank_top=rng.random() < 0.8, file_outer=rng.random() < 0.85,
                file_right=rng.random() < 0.55, upper=rng.random() < 0.06)

DISTRACT = '0123456789abcdefghABCDEFGH:.+-'
def distract(rng, img, M, s):
    d = ImageDraw.Draw(img); W = img.size[0]
    for _ in range(rng.randint(1, 8)):
        txt = ''.join(rng.choice(DISTRACT) for _ in range(rng.randint(1, 5)))
        f = font(rng.choice(FONTS), max(6, int(s * rng.uniform(0.15, 0.45))))
        if f is None: continue
        side = rng.randrange(4); t = rng.uniform(M - s * 0.5, M + 8 * s + s * 0.2)
        off = rng.uniform(0, s * 0.45)
        x, y = [(M - off - s * 0.3, t), (M + 8 * s + off, t), (t, M - off - s * 0.3), (t, M + 8 * s + off)][side]
        d.text((x, y), txt, font=f, fill=tuple(rng.randint(0, 255) for _ in range(3)))
    if rng.random() < 0.3:                      # a UI box / name plate overlapping the margin
        x = rng.uniform(0, W); y = rng.uniform(0, W)
        d.rectangle([x, y, x + rng.uniform(20, W / 2), y + rng.uniform(8, s)], fill=tuple(rng.randint(0, 255) for _ in range(3)))

def make(rng, sets, tex):
    s = rng.randint(56, 84)
    has = rng.random() < 0.72
    wb = rng.random() < 0.5
    cfg = label_cfg(rng) if has else None
    holder = {}; glyphs = np.zeros((4, 8), np.int8)
    def fn(img, M, s_):
        if cfg: holder['size'] = draw_labels(rng, img, M, s_, wb, cfg, glyphs)
    img, _, M, s = gen.render(rng, sets, tex, s=s, coords=False, coord_fn=fn)
    if rng.random() < 0.3: distract(rng, img, M, s)
    # the extension's crop: board + half a square, with imperfect board detection
    j = lambda: rng.uniform(-0.07, 0.07) * s
    x0, y0 = M - s / 2 + j(), M - s / 2 + j(); x1, y1 = M + 8.5 * s + j(), M + 8.5 * s + j()
    crop = img.crop((int(x0), int(y0), int(x1), int(y1)))
    vid_sq = rng.uniform(20, 110)                # square size in the video
    vw = max(48, int(9 * vid_sq))
    v = crop.resize((vw, vw), rng.choice([Image.BILINEAR, Image.BICUBIC, Image.LANCZOS, Image.BOX]))
    if rng.random() < 0.25: v = v.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.9)))
    if rng.random() < 0.8:
        b = io.BytesIO(); v.save(b, 'JPEG', quality=rng.randint(30, 92)); v = Image.open(b).convert('RGB')
    if rng.random() < 0.4:
        v = ImageEnhance.Brightness(v).enhance(rng.uniform(0.8, 1.2)); v = ImageEnhance.Contrast(v).enhance(rng.uniform(0.75, 1.2))
    frame = v.resize((F, F), rng.choice([Image.BILINEAR, Image.BICUBIC]))
    y = 0
    if cfg and holder.get('size'):
        size, contrast = holder['size']
        glyph_px = size / s * vid_sq                # label height in the video, roughly
        y = (1 if wb else 2) if glyph_px >= 4 and contrast >= 30 else 0
    if y == 0: glyphs[:] = 0
    return frame, y, glyphs

def build(n, seed, out):
    rng = random.Random(seed)
    sets, tex = gen.piece_sets(), gen.board_textures()
    X = np.lib.format.open_memmap(out + '_X.npy', mode='w+', dtype=np.uint8, shape=(n, 4, D, F - 2 * MG))
    Y = np.zeros(n, np.int64); Gl = np.zeros((n, 4, 8), np.int8)
    for i in range(n):
        fr, y, gl = make(rng, sets, tex)
        X[i] = np.clip(np.round(strips(to_gray(np.asarray(fr)))), 0, 255).astype(np.uint8); Y[i] = y; Gl[i] = gl
        if i % 5000 == 0: print(out, i, flush=True)
    X.flush(); np.save(out + '_Y.npy', Y); np.save(out + '_G.npy', Gl)

if __name__ == '__main__':
    if sys.argv[1] == 'preview':
        rng = random.Random(int(sys.argv[2])); sets, tex = gen.piece_sets(), gen.board_textures()
        tiles = []
        for k in range(12):
            fr, y, _ = make(rng, sets, tex)
            im = fr.copy(); ImageDraw.Draw(im).text((4, 4), ['none', 'WHITE', 'BLACK'][y], fill=(255, 0, 255))
            tiles.append(im)
        S = Image.new('RGB', (F * 4, F * 3))
        for k, t in enumerate(tiles): S.paste(t, ((k % 4) * F, (k // 4) * F))
        S.save('/home/claude/train/orient_preview.png')
    else:
        build(int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
