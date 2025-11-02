// app.js
// Sections: state, utils, adjacency, geometry, render, game logic, controls, zoom/pan, init

const TILINGS_URL = './tilings.json';
const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let tilingsCatalog = null;
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = 'square';
let currentAdjacency = 'edges4';

// state for view transform
const view = { scale: 0.6, tx: 0, ty: 0 };

// utils
function idx(rows, cols, r, c){ return r * cols + c; }
function inBounds(rows, cols, r, c){ return r >= 0 && r < rows && c >= 0 && c < cols; }
function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// adjacency helpers
function squareOffsets(r,c,adj){ return adj==='edges4' ? [[-1,0],[1,0],[0,-1],[0,1]] : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]; }
function hexOffsetsFor(r,c){
  // flat-topped hex, odd-q vertical layout; each has 6 edge neighbors
  const odd = (c & 1) === 1;
  return odd ? [[-1,0],[0,1],[1,0],[1,-1],[0,-1],[-1,-1]]
             : [[-1,1],[0,1],[1,1],[1,0],[0,-1],[-1,0]];
}
function triangleEquiOffsets(r,c,key){
  const up = ((r + c) & 1) === 0;
  if (key === 'triE-edge') return up ? [[0,-1],[0,1],[1,0]] : [[0,-1],[0,1],[-1,0]];
  if (key === 'triE-edgev') return up ? [[0,-1],[0,1],[1,0],[1,-1],[-1,0],[-1,1]] : [[0,-1],[0,1],[-1,0],[-1,-1],[1,0],[1,1]];
  return [];
}
function squareOctagonOffsets(r,c){ return [[-1,0],[1,0],[0,-1],[0,1]]; }

const ADJ_FN_REGISTRY = { squareOffsets, hexOffsetsFor, triangleEquiOffsets, squareOctagonOffsets };

// geometry spacing
function squareCenter(rows, cols, side){
  const PAD = 12; const centers=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const x = PAD + c * side + side/2;
    const y = PAD + r * side + side/2;
    centers.push({r,c,x,y});
  }
  return { centers, w: PAD*2 + cols*side, h: PAD*2 + rows*side };
}
function hexCenter(rows, cols, R){
  const hexHeight = Math.sqrt(3) * R;
  const xStep = 1.5 * R;
  const yStep = hexHeight;
  const PAD = 12; const centers=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const x = PAD + c * xStep + R;
    const y = PAD + r * yStep + ((c & 1) ? hexHeight/2 : 0);
    centers.push({r,c,x,y});
  }
  const w = PAD*2 + (cols-1) * xStep + 2*R;
  const h = PAD*2 + (rows-1) * yStep + hexHeight;
  return { centers, w, h };
}
function triCenter(rows, cols, side){
  const h = Math.sqrt(3)/2 * side;
  const xStep = side/2;
  const yStep = h/2;
  const PAD = 12; const centers=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const x = PAD + c * xStep + ((r & 1) ? side/4 : 0);
    const y = PAD + r * yStep;
    centers.push({r,c,x,y});
  }
  const w = PAD*2 + cols * xStep + side;
  const hTotal = PAD*2 + rows * yStep + h;
  return { centers, w, h: hTotal };
}

// rendering helpers
function makeSvg(tag, attrs){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function polyPoints(points){ return points.map(p=>`${p[0]},${p[1]}`).join(' '); }

// render pipeline
function renderTiledBoard(){
  const svg = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svg || !container || !gameGrid || !tilingsCatalog) return;

  svg.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  // auto size by cols with floor to keep edges crisp
  const baseSide = Math.max(14, Math.floor(900 / Math.max(12, cols)));

  const tiling = tilingsCatalog.tilings.find(t => t.id === currentTiling) || tilingsCatalog.tilings[0];

  let viewW = 800, viewH = 600;

  if (tiling.id === 'square'){
    const info = squareCenter(rows, cols, baseSide);
    viewW = info.w; viewH = info.h;
    svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);

    for (const cell of info.centers){
      const r=cell.r, c=cell.c, cx=cell.x, cy=cell.y;
      const s = baseSide/2;
      const pts = [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]];
      const poly = makeSvg('polygon', { points: polyPoints(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(11, Math.floor(baseSide * 0.45));
      const label = makeSvg('text', { x: cx, y: cy + Math.floor(fontSize*0.35), 'text-anchor':'middle', 'font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      attachCellHandlers(poly, r, c);
      attachCellHandlers(label, r, c, true);
      svg.appendChild(poly); svg.appendChild(label);
    }
  }
  else if (tiling.id === 'hex'){
    const R = baseSide/2;
    const info = hexCenter(rows, cols, R);
    viewW = info.w; viewH = info.h;
    svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);

    for (const cell of info.centers){
      const r=cell.r, c=cell.c, cx=cell.x, cy=cell.y;
      const pts = [];
      for (let k=0;k<6;k++){ const a = (Math.PI*2/6)*k; pts.push([cx + R*Math.cos(a), cy + R*Math.sin(a)]); }
      const poly = makeSvg('polygon', { points: polyPoints(pts), stroke:'var(--accent)', 'stroke-width':1.2, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(10, Math.floor(baseSide * 0.36));
      const label = makeSvg('text', { x: cx, y: cy + Math.floor(fontSize*0.35), 'text-anchor':'middle', 'font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      attachCellHandlers(poly, r, c);
      attachCellHandlers(label, r, c, true);
      svg.appendChild(poly); svg.appendChild(label);
    }
  }
  else if (tiling.id === 'triangle_equi'){
    const side = baseSide;
    const triH = Math.sqrt(3)/2 * side;
    const info = triCenter(rows, cols, side);
    viewW = info.w; viewH = info.h;
    svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);

    for (const cell of info.centers){
      const r=cell.r, c=cell.c, cx=cell.x, cy=cell.y;
      const up = ((r + c) & 1) === 0;
      const pts = up
        ? [[cx, cy - (2/3)*triH],[cx - side/2, cy + (1/3)*triH],[cx + side/2, cy + (1/3)*triH]]
        : [[cx, cy + (2/3)*triH],[cx - side/2, cy - (1/3)*triH],[cx + side/2, cy - (1/3)*triH]];
      const poly = makeSvg('polygon', { points: polyPoints(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(4,18,30,0.92)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(18,44,60,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(9, Math.floor(baseSide * 0.34));
      const label = makeSvg('text', { x: cx, y: cy + Math.floor(fontSize*0.3), 'text-anchor':'middle', 'font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      attachCellHandlers(poly, r, c);
      attachCellHandlers(label, r, c, true);
      svg.appendChild(poly); svg.appendChild(label);
    }
  }
  else if (tiling.id === 'square_octagon'){
    // simple 4.8.8 preview: draw octagons in a checker, squares in gaps (visual; gameplay uses square adjacency)
    const side = baseSide;
    const PAD = 12;
    const cellW = side, cellH = side;
    viewW = PAD*2 + cols * cellW;
    viewH = PAD*2 + rows * cellH;
    svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);

    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const cx = PAD + c*cellW + cellW/2;
        const cy = PAD + r*cellH + cellH/2;
        const isOct = ((r + c) % 2 === 0);
        const pts = isOct
          ? regularPolygonPoints(cx, cy, 8, cellW*0.42)
          : [[cx-cellW*0.42,cy-cellH*0.42],[cx+cellW*0.42,cy-cellH*0.42],[cx+cellW*0.42,cy+cellH*0.42],[cx-cellW*0.42,cy+cellH*0.42]];

        const poly = makeSvg('polygon', { points: polyPoints(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(6,18,26,0.94)' });
        const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
        if (cellObj.revealed) poly.setAttribute('fill','rgba(14,34,44,0.95)');
        if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
        if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

        const fontSize = Math.max(8, Math.floor(baseSide * 0.34));
        const label = makeSvg('text', { x: cx, y: cy + Math.floor(fontSize*0.35), 'text-anchor':'middle', 'font-size': fontSize });
        if (cellObj.revealed){
          if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
          else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
        } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

        attachCellHandlers(poly, r, c);
        attachCellHandlers(label, r, c, true);
        svg.appendChild(poly); svg.appendChild(label);
      }
    }
  }

  // apply view transform
  container.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  container.style.transformOrigin = 'center center';
}

// polygon helpers
function regularPolygonPoints(cx,cy,n,rad){
  const pts=[]; for(let k=0;k<n;k++){ const a=(Math.PI*2/n)*k; pts.push([cx+rad*Math.cos(a),cy+rad*Math.sin(a)]); } return pts;
}

// interaction helpers
function attachCellHandlers(el, r, c, isLabel=false){
  el.addEventListener('click', (e)=> {
    e.stopPropagation();
    if (!running) return;
    if (firstClick){
      const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10));
      placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]);
      firstClick = false;
    }
    const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
    if (res.exploded){
      running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; });
      const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM';
    } else {
      const ms=document.getElementById('msStatus');
      if (checkWin(gameGrid)){ running=false; if (ms) ms.textContent='You win!'; }
      else { if (ms) ms.textContent='Playing...'; }
    }
    renderTiledBoard();
  });
  el.addEventListener('contextmenu', (e)=> {
    e.preventDefault(); e.stopPropagation();
    if (!running) return;
    toggleFlag(gameGrid,r,c);
    if (checkWin(gameGrid)){
      running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!';
    }
    renderTiledBoard();
  });
}

// counts
function computeCountsWithAdjacency(grid, tilingId, adjacencyKey){
  const { rows, cols, cells } = grid;
  const tiling = tilingsCatalog && tilingsCatalog.tilings.find(t => t.id === tilingId);
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count = -1; continue; }
      const adj = tiling && tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type === 'offsets') offsets = adj.offsets;
        else if (adj.type === 'function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
      }
      let cnt=0;
      for (const [dr,dc] of offsets){
        const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue;
        if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
      }
      cells[i].count = cnt;
    }
  }
}

// reveal / flag / chord
function revealCell(grid,r,c,tilingId,adjKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed:[], exploded:false };
  const i = idx(rows,cols,r,c); const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed:[], exploded:false };
  if (cell.mine){ cell.revealed=true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  const tiling = tilingsCatalog && tilingsCatalog.tilings.find(t => t.id === tilingId);
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed=true; changed.push([rr,cc]);

    const adj = tiling && tiling.adjacencies[adjKey];
    let offsets = [];
    if (adj){
      if (adj.type==='offsets') offsets = adj.offsets;
      else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](rr,cc,adjKey);
    }
    if (cl.count === 0){
      for (const [dr,dc] of offsets){
        const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue;
        const ni=idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]);
      }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell||cell.revealed) return null; cell.flagged=!cell.flagged; return cell.flagged; }
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// controls
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:12}).value || 12));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:16}).value || 16));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:40}).value || 40));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows,cols);
  running = true; firstClick = true;
  const statusEl = document.getElementById('msStatus'); if (statusEl) statusEl.textContent = 'Ready — first click is safe';

  currentTiling = (document.getElementById('tilingSelect')||{}).value || (tilingsCatalog && tilingsCatalog.tilings[0] && tilingsCatalog.tilings[0].id);
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || (tilingsCatalog && tilingsCatalog.tilings[0] && Object.keys(tilingsCatalog.tilings[0].adjacencies)[0]);

  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
  renderTiledBoard();
}
function populateTilingControls(){
  const sel = document.getElementById('tilingSelect'); const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel || !tilingsCatalog) return;
  sel.innerHTML = '';
  for (const t of tilingsCatalog.tilings){ const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt); }
  function populateAdj(tilingKey){
    adjSel.innerHTML = '';
    const t = tilingsCatalog.tilings.find(x => x.id === tilingKey);
    if (!t) return;
    for (const aKey of Object.keys(t.adjacencies)){ const o = document.createElement('option'); o.value = aKey; o.textContent = t.adjacencies[aKey].label; adjSel.appendChild(o); }
    if (adjSel.options.length) adjSel.selectedIndex = 0;
  }
  sel.addEventListener('change', ()=>{
    const val = sel.value;
    populateAdj(val);
    currentTiling = val;
    currentAdjacency = adjSel.value;
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    renderTiledBoard();
  });
  adjSel.addEventListener('change', ()=>{
    currentAdjacency = adjSel.value;
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    renderTiledBoard();
  });
  sel.value = tilingsCatalog.tilings[0].id;
  populateAdj(sel.value);
  currentTiling = sel.value;
  currentAdjacency = adjSel.value;
}
function wireControls(){
  const newBtn = document.getElementById('newGame');
  if (newBtn){ newBtn.removeEventListener('click', startNewGame); newBtn.addEventListener('click', startNewGame); }

  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect){
    themeSelect.addEventListener('change', ()=>{
      document.body.setAttribute('data-theme', themeSelect.value || 'dark-ocean');
      renderTiledBoard();
    });
  }

  document.getElementById('msRows').addEventListener('change', ()=> { computeCountsWithAdjacency(gameGrid,currentTiling,currentAdjacency); renderTiledBoard(); });
  document.getElementById('msCols').addEventListener('change', ()=> { computeCountsWithAdjacency(gameGrid,currentTiling,currentAdjacency); renderTiledBoard(); });
  document.getElementById('msMines').addEventListener('change', ()=> renderTiledBoard());
}

// zoom and pan
function setupZoomPan(){
  const container = document.getElementById('minefieldContainer');
  if (!container) return;

  view.scale = 0.6; view.tx = 0; view.ty = 0;
  renderTiledBoard();

  let dragging = false;
  let startX=0, startY=0, startTx=0, startTy=0;

  container.addEventListener('pointerdown', (e)=>{
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startTx = view.tx; startTy = view.ty;
    container.setPointerCapture && container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    view.tx = startTx + dx;
    view.ty = startTy + dy;
    renderTiledBoard();
  });
  function endDrag(e){ dragging=false; container.releasePointerCapture && container.releasePointerCapture(e.pointerId); }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
  container.addEventListener('pointerleave', endDrag);

  // pinch gesture via pointer distance
  const pointers = new Map();
  function dist(p1,p2){ const dx=p2.clientX-p1.clientX, dy=p2.clientY-p1.clientY; return Math.hypot(dx,dy); }
  container.addEventListener('pointerdown', (e)=>{ pointers.set(e.pointerId,e); });
  container.addEventListener('pointermove', (e)=>{
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId,e);
    if (pointers.size===2){
      const it=pointers.values(); const pA=it.next().value; const pB=it.next().value;
      const d = dist(pA,pB);
      if (container._lastD == null) container._lastD = d;
      const ratio = d / container._lastD;
      container._lastD = d;
      view.scale = Math.max(0.1, Math.min(6, view.scale * ratio));
      renderTiledBoard();
    }
  });
  function clearPtr(e){ pointers.delete(e.pointerId); container._lastD=null; }
  container.addEventListener('pointerup', clearPtr);
  container.addEventListener('pointercancel', clearPtr);
  container.addEventListener('pointerout', clearPtr);
  container.addEventListener('pointerleave', clearPtr);

  // ctrl+wheel zoom for trackpads
  container.addEventListener('wheel', (e)=>{
    if (e.ctrlKey){
      const delta = -e.deltaY;
      const factor = 1 + Math.sign(delta) * Math.min(0.12, Math.abs(delta) / 500);
      view.scale = Math.max(0.1, Math.min(6, view.scale * factor));
      e.preventDefault();
      renderTiledBoard();
    }
  }, { passive:false });

  // keyboard zoom
  container.addEventListener('keydown', (e)=>{
    if (e.key === '+' || e.key === '='){ view.scale = Math.min(6, view.scale * 1.12); renderTiledBoard(); }
    if (e.key === '-' || e.key === '_'){ view.scale = Math.max(0.1, view.scale / 1.12); renderTiledBoard(); }
    if (e.key === '0'){ view.scale = 1.0; view.tx=0; view.ty=0; renderTiledBoard(); }
  });
}

// mines
function placeMines(grid, mineCount, tilingId, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell=>{ cell.mine=false; cell.revealed=false; cell.flagged=false; cell.count=0; });
  const total = rows*cols;
  const perm = Array.from({length:total},(_,i)=>i);
  for (let i=total-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc] = safeCell;
    const tiling = tilingsCatalog.tilings.find(t=>t.id===tilingId);
    if (tiling){
      const adj = tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type==='offsets') offsets = adj.offsets;
        else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](sr,sc,adjacencyKey);
      }
      offsets.push([0,0]);
      for (const [dr,dc] of offsets){
        const rr=sr+dr, cc=sc+dc; if (!inBounds(rows,cols,rr,cc)) continue;
        forbidden.add(idx(rows,cols,rr,cc));
      }
    }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){
    const pos=perm[k++]; if (forbidden.has(pos)) continue;
    cells[pos].mine=true; placed++;
  }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingId, adjacencyKey);
}

// init
function loadTilingsAndInit(){
  fetch(TILINGS_URL).then(r=>{
    if (!r.ok) throw new Error('tilings.json load failed');
    return r.json();
  }).then(data=>{
    tilingsCatalog = data;
    populateTilingControls();
    wireControls();
    setupZoomPan();
    startNewGame();
  }).catch(err=>{
    console.error('tilings load error', err);
    tilingsCatalog = {
      tilings: [
        { id:'square', name:'Square',
          adjacencies:{ edges4:{label:'Edges', type:'offsets', offsets:[[-1,0],[1,0],[0,-1],[0,1]]},
                        all8:{label:'All 8', type:'offsets', offsets:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]} } },
        { id:'hex', name:'Hexagon',
          adjacencies:{ hex6:{label:'Edges', type:'function', fn:'hexOffsetsFor'} } },
        { id:'triangle_equi', name:'Equilateral Triangle',
          adjacencies:{ triE-edge:{label:'Edges', type:'function', fn:'triangleEquiOffsets'},
                        triE-edgev:{label:'Edges+Vertices', type:'function', fn:'triangleEquiOffsets'} } },
        { id:'square_octagon', name:'Square & Octagon',
          adjacencies:{ mixed-edge:{label:'Edges', type:'function', fn:'squareOctagonOffsets'} } }
      ]
    };
    populateTilingControls();
    wireControls();
    setupZoomPan();
    startNewGame();
  });
}

document.addEventListener('DOMContentLoaded', loadTilingsAndInit);
