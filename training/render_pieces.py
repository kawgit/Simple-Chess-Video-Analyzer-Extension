import cairosvg, os, sys, io
from PIL import Image
import sys
src=sys.argv[1]  # path to lichess-org/lila public/piece
out=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pieces')
skip={'disguised','mono'}
ok=0
for s in sorted(os.listdir(src)):
    if s in skip: continue
    os.makedirs(f'{out}/{s}',exist_ok=True)
    for c in 'wb':
        for p in 'KQRBNP':
            f=f'{src}/{s}/{c}{p}.svg'
            try:
                png=cairosvg.svg2png(url=f,output_width=128,output_height=128)
                im=Image.open(io.BytesIO(png)).convert('RGBA')
                im.save(f'{out}/{s}/{c}{p}.png'); ok+=1
            except Exception as e: print('FAIL',f,e)
print(ok)
