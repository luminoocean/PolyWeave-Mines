// app.js — updated: proper triangle grid, hex parity fix, cairo rendering, centered scaling,
// container frame remains fixed; tilings.json-driven adjacency hooks.

const TILINGS_URL = './tilings.json';
const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let tilingsCatalog = null;
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = 'square';
let currentAdjacency = 'edges4';

// basic grid utils
function idx(rows,cols,r,c){ return r*cols + c; }
function inBounds(rows,cols,r,c){ return r>=0 && r<rows && c>=0 && c<cols; }
function createGrid(rows,cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// adjacency functions registry
function hexOffsetsFor(r,c){
  // odd-q vertical layout: odd columns (c&1 === 1) are offset downwards
  const odd = (c & 1) === 1;
  return odd ? [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] : [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
}
function triangleEquiOffsets(r,c,adjKey){
  // orientation alternates by parity (r + c)
  const up = ((r + c) & 1) === 0;
  if (adjKey === 'triE-edge') return up ? [[0,-1],[0,1],[1,0]] : [[0,-1],[0,1],[-1,0]];
  if (adjKey === 'triE-edgev') return up ? [[0,-1],[0,1],[1,0],[1,-1],[-1,0],[-1,1]] : [[0,-1],[0,1],[-1,0],[-1,-1],[1,0],[1,1]];
  return [];
}
function cairoOffsets(r,c,adjKey){
  // simple fallback: 5-adjacency in a ring (approximate) — good enough for gameplay; refine later
  return [[-1,0],[1,0],[0,-1],[0,1],[-1,1]];
}
const ADJ_FN_REGISTRY = { hexOffsetsFor, triangleEquiOffsets, cairoOffsets };

// compute neighbor counts based on tiling adjacency
function computeCountsWithAdjacency(grid, tilingId, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!tilingsCatalog) return;
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }
      const adj = tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type === 'offsets') offsets = adj.offsets;
        else if (adj.type === 'function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
      }
      let cnt = 0;
      for (const [dr,dc] of offsets){
        const rr=r+dr, cc=c+dc;
        if (!inBounds(rows,cols,rr,cc)) continue;
        if (grid.cells[idx(rows,cols,rr,cc)].mine) cnt++;
      }
      cells[i].count = cnt;
    }
  }
}

// mines placement (safe-first)
function placeMines(grid,mineCount,tilingId,adjKey,safeCell=null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell=>{ cell.mine=false; cell.count=0; cell.revealed=false; cell.flagged=false; });
  const total = rows*cols;
  const perm = Array.from({length:total},(_,i)=>i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc] = safeCell;
    const tiling = tilingsCatalog.tilings.find(t=>t.id===tilingId);
    if (tiling){
      const adj = tiling.adjacencies[adjKey];
      let offsets = [];
      if (adj){
        if (adj.type==='offsets') offsets = adj.offsets;
        else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](sr,sc,adjKey);
      }
      offsets.push([0,0]);
      for (const [dr,dc] of offsets){ const rr=sr+dr, cc=sc+dc; if (!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
    }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){ const pos=perm[k++]; if (forbidden.has(pos)) continue; cells[pos].mine=true; placed++; }
  grid.mines = placed;
  computeCountsWithAdjacency(grid,tilingId,adjKey);
}

// reveal / flag logic
function revealCell(grid,r,c,tilingId,adjKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed:[], exploded:false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed:[], exploded:false };
  if (cell.mine) { cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  const tiling = tilingsCatalog.tilings.find(t=>t.id===tilingId);
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed = true; changed.push([rr,cc]);

    const adj = tiling && tiling.adjacencies[adjKey];
    let offsets = [];
    if (adj){
      if (adj.type==='offsets') offsets = adj.offsets;
      else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](rr,cc,adjKey);
    }
    if (cl.count === 0){
      for (const [dr,dc] of offsets){ const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni=idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]); }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell||cell.revealed) return null; cell.flagged=!cell.flagged; return cell.flagged; }
function countFlaggedNeighbors(grid,r,c,tilingId,adjKey){
  const tiling = tilingsCatalog.tilings.find(t=>t.id===tilingId); if (!tiling) return 0;
  const adj = tiling.adjacencies[adjKey]; let offsets = [];
  if (adj){
    if (adj.type==='offsets') offsets = adj.offsets;
    else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjKey);
  }
  let cnt=0;
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) cnt++; }
  return cnt;
}
function revealUnflaggedNeighbors(grid,r,c,tilingId,adjKey){
  const tiling = tilingsCatalog.tilings.find(t=>t.id===tilingId); if (!tiling) return [];
  const adj = tiling.adjacencies[adjKey]; let offsets = [];
  if (adj){
    if (adj.type==='offsets') offsets = adj.offsets;
    else if (adj.type==='function' && ADJ_FN_REGISTRY[adj.fn]) offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjKey);
  }
  const toReveal=[];
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; const cell = grid.cells[idx(grid.rows,grid.cols,rr,cc)]; if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]); }
  return toReveal;
}
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// SVG helpers
function makeSvgElement(tag, attrs={}){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points){ return points.map(p=>`${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx,cy,size){ const s=size/2; return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]]; }
function computeHexPolygon(cx,cy,radius){ const pts=[]; for (let k=0;k<6;k++){ const angle=k*Math.PI/3; pts.push([cx+radius*Math.cos(angle), cy+radius*Math.sin(angle)]); } return pts; }

// center calculators (consistent grids)
function squareCenter(rows,cols,size){
  const PAD=12; const centers=[]; for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = c*size + size/2 + PAD; const y = r*size + size/2 + PAD; centers.push({r,c,x,y}); }
  return { centers, w: cols*size + 24, h: rows*size + 24 };
}
function hexCenter(rows,cols,radius){
  const R = radius; const hexWidth = 2*R; const hexHeight = Math.sqrt(3)*R; const xStep = 1.5*R; const yStep = hexHeight; const centers=[]; const PAD=12;
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const x = c*xStep + R + PAD; const y = r*yStep + ((c & 1) ? (hexHeight/2) : 0) + R + PAD; centers.push({r,c,x,y}); } }
  return { centers, w:(cols-1)*xStep + hexWidth + PAD*2, h:(rows-1)*yStep + hexHeight + PAD*2 };
}
function triCenter(rows,cols,side){
  // proper triangular grid on a rectangular index: x-step = side/2, y-step = h/2; orientation alternates by r+c parity
  const PAD=12; const h = Math.sqrt(3)/2 * side; const centers=[]; for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const x = PAD + c * (side * 0.5) + ((r & 1) ? side*0.25 : 0); const y = PAD + r * (h * 0.5); centers.push({r,c,x,y}); } }
  return { centers, w: cols * side * 0.5 + PAD*2 + side, h: rows * h * 0.5 + PAD*2 + h };
}

// render pipeline (centered scaling; SVG sized to include full content)
function renderTiledBoard(){
  const svgRoot = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svgRoot || !container || !gameGrid || !tilingsCatalog) return;
  svgRoot.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const baseSize = Math.max(12, Math.floor(720 / Math.max(8, cols)));

  const zoomTyped = Number((document.getElementById('zoomValue')||{value:1}).value || 1);
  const gapX = Number((document.getElementById('xGapValue')||{value:1}).value || 1);
  const gapY = Number((document.getElementById('yGapValue')||{value:1}).value || 1);

  // center-based scaling
  const zoomScale = Math.max(0.05, Math.min(8, zoomTyped));
  container.style.transform = `scale(${zoomScale})`;
  container.style.transformOrigin = 'center center';

  const gapUnitX = (gapX - 1) * baseSize * 0.45;
  const gapUnitY = (gapY - 1) * baseSize * 0.42;
  const colCenter = (cols - 1) / 2;

  const tiling = tilingsCatalog.tilings.find(t=>t.id===currentTiling) || tilingsCatalog.tilings[0];

  let viewW = 800, viewH = 600;

  if (tiling.id === 'square'){
    const centers = squareCenter(rows,cols,baseSize);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    for (const cell of centers.centers){
      const r=cell.r,c=cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeSquarePolygon(cx,cy,baseSize);
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      const fontSize = Math.max(10, baseSize * 0.45);
      const label = makeSvgElement('text',{ x:cx, y:cy+4, 'text-anchor':'middle','font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }
      (function(r,c){ poly.addEventListener('click', ()=> { if(!running) return; if (firstClick){ const mines = Math.max(1, Number(document.getElementById('msMines').value || 10)); placeMines(gameGrid,mines,currentTiling,currentAdjacency,[r,c]); firstClick=false; } const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency); if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if(cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; } else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; } renderTiledBoard(); }); poly.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } renderTiledBoard(); }); })(cell.r,cell.c);
      svgRoot.appendChild(poly); svgRoot.appendChild(label);
    }
    return;
  }

  if (tiling.id === 'hex'){
    const centers = hexCenter(rows,cols,baseSize/2);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    for (const cell of centers.centers){
      const r=cell.r,c=cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeHexPolygon(cx,cy,baseSize/2);
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      const fontSize = Math.max(9, baseSize * 0.36);
      const label = makeSvgElement('text',{ x:cx, y:cy+4, 'text-anchor':'middle','font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      (function(r,c){ poly.addEventListener('click', ()=> { if(!running) return; if (firstClick){ const mines = Math.max(1, Number(document.getElementById('msMines').value || 10)); placeMines(gameGrid,mines,currentTiling,currentAdjacency,[r,c]); firstClick=false; } const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency); if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if(cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; } else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; } renderTiledBoard(); }); poly.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } renderTiledBoard(); }); })(cell.r,cell.c);

      svgRoot.appendChild(poly); svgRoot.appendChild(label);
    }
    return;
  }

  if (tiling.id === 'triangle_equi'){
    const centers = triCenter(rows,cols,baseSize);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    for (const cell of centers.centers){
      const r=cell.r,c=cell.c;
      const side = baseSize;
      const triH = Math.sqrt(3)/2 * side;
      const up = ((r + c) & 1) === 0;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const points = up ? [[cx, cy - (2/3)*triH],[cx - side/2, cy + (1/3)*triH],[cx + side/2, cy + (1/3)*triH]] : [[cx, cy + (2/3)*triH],[cx - side/2, cy - (1/3)*triH],[cx + side/2, cy - (1/3)*triH]];
      const poly = makeSvgElement('polygon',{ points: pointsToStr(points), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(4,18,30,0.92)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(18,44,60,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      const fontSize = Math.max(8, baseSize * 0.36);
      const label = makeSvgElement('text',{ x:cx, y:cy+4, 'text-anchor':'middle','font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      (function(r,c){ poly.addEventListener('click', ()=> { if(!running) return; if (firstClick){ const mines = Math.max(1, Number(document.getElementById('msMines').value || 10)); placeMines(gameGrid,mines,currentTiling,currentAdjacency,[r,c]); firstClick=false; } const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency); if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if(cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; } else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; } renderTiledBoard(); }); poly.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } renderTiledBoard(); }); })(cell.r,cell.c);

      svgRoot.appendChild(poly); svgRoot.appendChild(label);
    }
    return;
  }

  // Cairo fallback: draw pentagons by placing small rotated pentagons in a grid (visual-only; adjacency via cairoOffsets)
  if (tiling.id === 'cairo'){
    const centers = squareCenter(rows,cols,Math.floor(baseSize*0.95));
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    for (const cell of centers.centers){
      const r=cell.r,c=cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const side = baseSize * 0.9;
      const pts = [];
      for (let k=0;k<5;k++){ const ang = (Math.PI*2/5)*k - Math.PI/2; pts.push([cx + Math.cos(ang)*side*0.38, cy + Math.sin(ang)*side*0.38]); }
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(6,18,26,0.94)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(14,34,44,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      const fontSize = Math.max(8, baseSize * 0.36);
      const label = makeSvgElement('text',{ x:cx, y:cy+4, 'text-anchor':'middle','font-size': fontSize });
      if (cellObj.revealed){
        if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
      } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

      (function(r,c){ poly.addEventListener('click', ()=> { if(!running) return; if (firstClick){ const mines = Math.max(1, Number(document.getElementById('msMines').value || 10)); placeMines(gameGrid,mines,currentTiling,currentAdjacency,[r,c]); firstClick=false; } const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency); if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if(cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; } else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; } renderTiledBoard(); }); poly.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } renderTiledBoard(); }); })(cell.r,cell.c);

      svgRoot.appendChild(poly); svgRoot.appendChild(label);
    }
    return;
  }

  // default fallback to square
  const centers = squareCenter(rows,cols,baseSize);
  viewW = centers.w + Math.abs(gapUnitX) * cols;
  viewH = centers.h + Math.abs(gapUnitY) * rows;
  svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svgRoot.setAttribute('width', viewW);
  svgRoot.setAttribute('height', viewH);
  for (const cell of centers.centers){
    const r=cell.r,c=cell.c;
    const cx = cell.x + (c - colCenter) * gapUnitX;
    const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
    const pts = computeSquarePolygon(cx,cy,baseSize);
    const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)' });
    const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
    if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
    if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
    if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
    const fontSize = Math.max(10, baseSize * 0.45);
    const label = makeSvgElement('text',{ x:cx, y:cy+4, 'text-anchor':'middle','font-size': fontSize });
    if (cellObj.revealed){
      if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
      else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
    } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }
    (function(r,c){ poly.addEventListener('click', ()=> { if(!running) return; if (firstClick){ const mines = Math.max(1, Number(document.getElementById('msMines').value || 10)); placeMines(gameGrid,mines,currentTiling,currentAdjacency,[r,c]); firstClick=false; } const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency); if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if(cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; } else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; } renderTiledBoard(); }); poly.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } renderTiledBoard(); }); })(cell.r,cell.c);
    svgRoot.appendChild(poly); svgRoot.appendChild(label);
  }
}

// controls + wiring
function startNewGame(){
  const rows = Math.max(3, Number(document.getElementById('msRows').value || 9));
  const cols = Math.max(3, Number(document.getElementById('msCols').value || 9));
  let mines = Math.max(1, Number(document.getElementById('msMines').value || 10));
  mines = Math.min(mines, rows*cols - 1);
  gameGrid = createGrid(rows,cols);
  running = true; firstClick = true;
  document.getElementById('msStatus').textContent = 'Ready — first click is safe';
  currentTiling = document.getElementById('tilingSelect').value || (tilingsCatalog && tilingsCatalog.tilings[0].id);
  currentAdjacency = document.getElementById('adjacencySelect').value || (tilingsCatalog && Object.keys(tilingsCatalog.tilings[0].adjacencies)[0]);
  computeCountsWithAdjacency(gameGrid,currentTiling,currentAdjacency);
  renderTiledBoard();
  try{ window.gameGrid = gameGrid; }catch(e){}
}

function populateTilingControls(){
  const sel = document.getElementById('tilingSelect'); const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel || !tilingsCatalog) return;
  sel.innerHTML = '';
  for (const t of tilingsCatalog.tilings){ const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt); }
  function populateAdj(key){
    adjSel.innerHTML = '';
    const t = tilingsCatalog.tilings.find(x=>x.id===key);
    if (!t) return;
    for (const aKey of Object.keys(t.adjacencies)){ const o = document.createElement('option'); o.value = aKey; o.textContent = t.adjacencies[aKey].label; adjSel.appendChild(o); }
    if (adjSel.options.length) adjSel.selectedIndex = 0;
  }
  sel.addEventListener('change', ()=>{ populateAdj(sel.value); currentTiling = sel.value; currentAdjacency = adjSel.value; renderTiledBoard(); });
  adjSel.addEventListener('change', ()=>{ currentAdjacency = adjSel.value; renderTiledBoard(); });
  sel.value = tilingsCatalog.tilings[0].id; populateAdj(sel.value); currentTiling = sel.value; currentAdjacency = adjSel.value;
}

function wireControls(){
  const newBtn = document.getElementById('newGame'); if (newBtn){ newBtn.removeEventListener('click', startNewGame); newBtn.addEventListener('click', startNewGame); }
  const theme = document.getElementById('themeSelect'); if (theme){ theme.addEventListener('change', ()=>{ document.body.setAttribute('data-theme', theme.value || 'dark-ocean'); }); }
  const zoomValue = document.getElementById('zoomValue'); const xGap = document.getElementById('xGapValue'); const yGap = document.getElementById('yGapValue');
  if (zoomValue) zoomValue.addEventListener('blur', ()=>{ let v=Number(zoomValue.value); if (Number.isNaN(v)) v=1; zoomValue.value = Number(v).toFixed(2); renderTiledBoard(); });
  if (xGap) xGap.addEventListener('blur', ()=>{ let v=Number(xGap.value); if (Number.isNaN(v)) v=1; xGap.value = Number(v).toFixed(2); renderTiledBoard(); });
  if (yGap) yGap.addEventListener('blur', ()=>{ let v=Number(yGap.value); if (Number.isNaN(v)) v=1; yGap.value = Number(v).toFixed(2); renderTiledBoard(); });
  document.getElementById('msRows').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msCols').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msMines').addEventListener('change', ()=> renderTiledBoard());
}

// load tilings.json then init
function loadTilingsAndInit(){
  fetch(TILINGS_URL).then(r=>{ if (!r.ok) throw new Error('tilings.json load failed'); return r.json(); }).then(data=>{
    tilingsCatalog = data;
    populateTilingControls();
    wireControls();
    startNewGame();
  }).catch(err=>{
    console.error('tilings load error', err);
    // fallback minimal catalog
    tilingsCatalog = { tilings: [ { id:'square', name:'Square', adjacencies:{ edges4:{label:'Von Neumann (4)', type:'offsets', offsets:[[-1,0],[1,0],[0,-1],[0,1]]} } } ] };
    populateTilingControls(); wireControls(); startNewGame();
  });
}

document.addEventListener('DOMContentLoaded', loadTilingsAndInit);
