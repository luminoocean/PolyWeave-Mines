// docs/app.js — minimal playground logic (no bundler)
async function loadPresets() {
  const res = await fetch('./shape-presets.json', {cache:'no-store'});
  if (!res.ok) throw new Error('Could not load presets');
  return await res.json();
}

function render2D(canvas, cells) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#021825'; ctx.fillRect(0,0,canvas.width,canvas.height);
  if (!cells || cells.length === 0) return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  cells.forEach(([x,y])=>{ minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); });
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const scale = Math.min((canvas.width-40)/w, (canvas.height-40)/h, 32);
  const ox = (canvas.width - w*scale)/2, oy = (canvas.height - h*scale)/2;
  ctx.fillStyle = '#9be7ff';
  cells.forEach(([x,y])=>{
    const cx = ox + (x - minX) * scale, cy = oy + (y - minY) * scale;
    ctx.fillRect(cx+1, cy+1, Math.max(1, scale-2), Math.max(1, scale-2));
  });
}

function expandImplicit(preset) {
  if (preset.type === 'implicit') {
    const dims = preset.dims;
    const cells = [];
    const R = preset.rule.radius ?? 1;
    const limits = Array(dims).fill(0).map(()=>({min:-R, max:R}));
    function recur(coord,i){
      if (i===dims){
        const manhattan = coord.reduce((s,v)=>s+Math.abs(v),0);
        if (preset.rule.type === 'manhattan' && manhattan <= R) cells.push(coord.slice());
        if (preset.rule.type === 'hyperplane' && coord[preset.rule.axis||(dims-1)] === (preset.rule.value||0)) cells.push(coord.slice());
        if (preset.rule.type === 'hexagon' && dims===2) {
          // axial coords for small hexagon radius R (approx): include if |x|+|y|+|x+y| <= 2R
          const x=coord[0], y=coord[1];
          if (Math.abs(x)+Math.abs(y)+Math.abs(x+y) <= 2*R) cells.push(coord.slice());
        }
        return;
      }
      for (let v=limits[i].min; v<=limits[i].max; v++){ coord[i]=v; recur(coord,i+1); }
    }
    recur(Array(dims).fill(0),0);
    return cells;
  }
  if (preset.type === 'generator' && preset.params.type === 'hypercube') {
    const size = preset.params.size || 2; const dims = preset.dims;
    const cells = [];
    const recur = (coord,i)=>{ if (i===dims){ cells.push(coord.slice()); return; } for (let v=0; v<size; v++){ coord[i]=v; recur(coord,i+1); } };
    recur(Array(dims).fill(0),0); return cells;
  }
  return preset.cells || [];
}

async function init() {
  const presets = await loadPresets();
  const select = document.getElementById('presetSelect');
  presets.forEach(p=>{ const o = document.createElement('option'); o.value=p.id; o.textContent=`${p.id} (${p.dims}D)`; select.appendChild(o); });
  const canvas = document.getElementById('canvas2d');
  document.getElementById('renderBtn').addEventListener('click', ()=>{
    const chosen = presets.find(p=>p.id === select.value);
    if (!chosen) return;
    const cells = expandImplicit(chosen).map(c=>c.slice(0,2)); // show first two axes
    render2D(canvas, cells);
    document.getElementById('meshMsg').textContent = `Preview: ${chosen.id}`;
  });
  // initial render
  if (presets.length) { select.value = presets[0].id; document.getElementById('renderBtn').click(); }
}

init().catch(e=>{ console.error(e); document.getElementById('meshMsg').textContent = 'Error loading presets'; });
