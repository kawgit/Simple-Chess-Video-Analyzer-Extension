"""Synthetic scans with a known last-move highlight (or none) + distractors,
for evaluating the highlight detector. Writes raw RGBA boards + truth json."""
import sys, json, random, numpy as np
import gen

LASTMOVE = [((155, 199, 0), 105), ((255, 255, 51), 128), ((247, 247, 105), 200), ((205, 210, 106), 220),
            ((100, 160, 255), 110), ((170, 162, 58), 200), ((187, 203, 43), 160)]
RED = ((235, 97, 80), 205)
SELECT = ((20, 85, 30), 128)
PREMOVE = ((20, 30, 85), 128)

def scenario(rng):
    pos = gen.rand_position(rng)
    occ = [(r, f) for r in range(8) for f in range(8) if pos[r, f]]
    emp = [(r, f) for r in range(8) for f in range(8) if not pos[r, f]]
    kind = rng.choices(['normal', 'drag_cc', 'drag_li', 'none', 'red_pair'], [0.55, 0.12, 0.13, 0.1, 0.1])[0]
    hls, truth = [], None
    if kind != 'none':
        to, fr = rng.choice(occ), rng.choice(emp)
        col, a = rng.choice(LASTMOVE)
        hls.append({'squares': [fr, to], 'color': col, 'alpha': a})
        truth = sorted([fr[0] * 8 + fr[1], to[0] * 8 + to[1]])
        used = {fr, to}
        if kind == 'drag_cc':      # chess.com: picked-up piece's square gets the same colour
            x = rng.choice([q for q in occ if q not in used])
            hls.append({'squares': [x], 'color': col, 'alpha': a}); truth = None
        if kind == 'drag_li':      # lichess: selected square in a different colour
            x = rng.choice([q for q in occ if q not in used])
            hls.append({'squares': [x], 'color': SELECT[0], 'alpha': SELECT[1]})
        if kind == 'red_pair':     # user-marked red squares (one empty, one occupied)
            hls.append({'squares': [rng.choice([q for q in occ if q not in used]), rng.choice([q for q in emp if q not in used])], 'color': RED[0], 'alpha': RED[1]})
        if kind == 'normal':
            for _ in range(rng.choice([0, 0, 0, 1, 1, 3])):
                hls.append({'squares': [(rng.randrange(8), rng.randrange(8))], 'color': RED[0], 'alpha': RED[1]})
            if rng.random() < 0.1:
                hls.append({'squares': [rng.choice(occ)], 'color': PREMOVE[0], 'alpha': PREMOVE[1]})
    # drop distractor squares that collide with the last-move pair
    if truth:
        lm = {(t // 8, t % 8) for t in truth}
        for h in hls[1:]:
            h['squares'] = [q for q in h['squares'] if q not in lm]
    return pos, hls, truth, kind

if __name__ == '__main__':
    n, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    rng = random.Random(seed)
    sets, tex = gen.piece_sets(), gen.board_textures()
    boards, meta = [], []
    for i in range(n):
        pos, hls, truth, kind = scenario(rng)
        b, pos = gen.sample_board(rng, sets, tex, box_err=0.04, pos=pos, highlights=hls)
        rgba = np.concatenate([b, np.full(b.shape[:2] + (1,), 255, np.uint8)], 2)
        boards.append(rgba)
        cells = ''.join('.KQRBNPkqrbnp'[c] for c in pos.reshape(-1))
        meta.append({'truth': truth, 'kind': kind, 'cells': cells, 'theme': 'gray' if gen.LAST_GRAY else gen.LAST_THEME, 'sq': gen.LAST_SQ})
    np.stack(boards).tofile(out + '.rgba')
    json.dump(meta, open(out + '.json', 'w'))
