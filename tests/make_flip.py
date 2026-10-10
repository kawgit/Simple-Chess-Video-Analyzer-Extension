import sys, os, json, shutil
sys.path.insert(0, '/home/claude/e2e'); sys.path.insert(0, '/home/claude/train')
import gen, make_frames2 as mf
sets = gen.piece_sets(); print(sets[:5])
A, B, OUT = '/tmp/claude-0/flipA', '/tmp/claude-0/flipB', '/home/claude/e2e/site/flip'
for d in (A, B, OUT): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
mf.main(A, sets[0], 'lichess', True, 11, 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7'.split(), labels=True)
mf.main(B, sets[0], 'lichess', False, 12, 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+'.split(), labels=True)
fr = []
for tag, d in (('a', A), ('b', B)):
    t = json.load(open(d + '/truth.json'))
    for f in t['frames']:
        shutil.copy(f"{d}/{f['file']}", f"{OUT}/{tag}{f['file']}"); fr.append(dict(f, file=tag + f['file'], game=tag))
json.dump({'frames': fr, 'box': t['box']}, open(OUT + '/truth.json', 'w'))
print(len(fr))
