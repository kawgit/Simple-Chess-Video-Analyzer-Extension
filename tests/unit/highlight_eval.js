const fs=require('fs'); const {findLastMove}=require(__dirname + '/../../extension/highlights.js');
const base=process.argv[2]; const meta=JSON.parse(fs.readFileSync(base+'.json')); const raw=fs.readFileSync(base+'.rgba');
const N=256*256*4; const st={};
meta.forEach((m,i)=>{
  const px=new Uint8ClampedArray(raw.buffer, raw.byteOffset+i*N, N);
  const r=findLastMove(px, m.cells); const got=r.pair? r.pair.join(','):null, want=m.truth? m.truth.join(','):null;
  const k=m.theme+'/'+(m.kind==='none'||m.kind==='drag_cc'?'nopair':'pair'); st[k]=st[k]||{n:0,ok:0,wrong:0,miss:0};
  st[k].n++; if(got===want) st[k].ok++; else if(got) st[k].wrong++; else st[k].miss++;
});
for (const k of Object.keys(st).sort()) console.log(k.padEnd(16), JSON.stringify(st[k]));
