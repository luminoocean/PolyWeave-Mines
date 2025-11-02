// app.js — new structure: tilings.json load, separate tiling helpers, and container-based zoom
// Overview:
// - Loads tilings.json (expects it next to index.html)
// - Renders into #minefieldSvg and applies CSS scale to #minefieldContainer using zoomValue
// - Reads typed zoom and gap values (zoom text box controls container scale directly)
// - Uses modular adjacency helpers (square, hex, triangle). More patterns from tilings.json can be added.
// - Keeps existing gameplay logic (place mines, reveal, flag, chord) but uses per-tiling neighbor logic.

const TILINGS_URL = './tilings.json';
const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let tilingsCatalog = null;
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = 'square';
let currentAdjacency = 'edges4';
let debugEnabled = false;

// --- Basic grid utilities ---
function idx(rows, cols, r, c){ return r * cols + c; }
function inBounds(rows, cols, r, c){ return r >= 0 && r < rows && c >= 0 && c < cols; }
function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// --- Adjacency helpers exported by name to be referenced by tilings.json functions ---
function hexOffsetsFor(r, c){
  const evenCol = (c % 2) === 0;
  if (evenCol) return [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]];
  return [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
}
function triangleEquiOffsets(r, c, adjKey){
  const up = ((r + c) % 2) === 0;
  if (adjKey === 'triE-edge') return up ? [[0,-1],[0,1],[1,0]] : [[0,-1],[0,1],[-1,0]];
  if (adjKey === 'triE-edgev') return up ? [[0,-1],[0,1],[1,0],[1,-1],[-1,0],[-1,1]] : [[0,-1],[0,1],[-1,0],[-1,-1],[1,0],[1,1]];
  const arr=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]);
  return arr;
}
function squareOffsets(r,c,adjKey){
  if (adjKey === 'edges4') return [[-1,0],[1,0],[0,-1],[0,1]];
  return [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
}

// a small registry so strings in tilings.json can map to functions
const ADJ_FN_REGISTRY = { hexOffsetsFor, triangleEquiOffsets, squareOffsets };

// --- compute counts using the tiling metadata (tilingsCatalog) ---
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
      if (!adj) offsets = [];
      else if (adj.type === 'offsets') offsets = adj.offsets;
      else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') {
        offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
      }
      let cnt = 0;
      for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
  }
}

// --- mine placement (safe first click) ---
function placeMines(grid, mineCount, tilingId, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine=false; cell.count=0; cell.revealed=false; cell.flagged=false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc] = safeCell;
    const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
    if (tiling){
      const adj = tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type === 'offsets') offsets = adj.offsets;
        else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](sr,sc,adjacencyKey);
      }
      offsets.push([0,0]);
      for (const [dr,dc] of offsets){ const rr=sr+dr, cc=sc+dc; if (!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
    }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){ const pos=perm[k++]; if (forbidden.has(pos)) continue; cells[pos].mine=true; placed++; }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingId, adjacencyKey);
}

// --- reveal/flag/chord ---
function revealCell(grid,r,c,tilingId,adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded:false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed: [], exploded:false };
  if (cell.mine) { cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed=true; changed.push([rr,cc]);

    // neighbors
    const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
    const adj = tiling && tiling.adjacencies[adjacencyKey];
    let offsets = [];
    if (adj){
      if (adj.type === 'offsets') offsets = adj.offsets;
      else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](rr,cc,adjacencyKey);
    }

    if (cl.count === 0){
      for (const [dr,dc] of offsets){ const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni=idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]); }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell||cell.revealed) return null; cell.flagged=!cell.flagged; return cell.flagged; }
function countFlaggedNeighbors(grid,r,c,tilingId,adjacencyKey){
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return 0;
  const adj = tiling.adjacencies[adjacencyKey];
  let offsets = [];
  if (adj){
    if (adj.type === 'offsets') offsets = adj.offsets;
    else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
  }
  let cnt=0;
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) cnt++; }
  return cnt;
}
function revealUnflaggedNeighbors(grid,r,c,tilingId,adjacencyKey){
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return [];
  const adj = tiling.adjacencies[adjacencyKey];
  let offsets = [];
  if (adj){
    if (adj.type === 'offsets') offsets = adj.offsets;
    else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
  }
  const toReveal=[];
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; const cell = grid.cells[idx(grid.rows,grid.cols,rr,cc)]; if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]); }
  return toReveal;
}
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// --- SVG helpers & layout ---
function makeSvgElement(tag, attrs={}){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points){ return points.map(p=>`${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx,cy,size){ const s=size/2; return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]]; }
function computeHexPolygon(cx,cy,radius){ const pts=[]; for (let k=0;k<6;k++){ const angle=k*Math.PI/3; pts.push([cx+radius*Math.cos(angle), cy+radius*Math.sin(angle)]); } return pts; }

// --- centers helpers (square / hex / triangle) ---
function squareCenter(rows, cols, size){ const PAD=8; const centers=[]; for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = c*size + size/2 + PAD; const y = r*size + size/2 + PAD; centers.push({r,c,x,y}); } return { centers, w: cols*size + 16, h: rows*size + 16 }; }
function hexCenter(rows, cols, radius){ const R = radius; const hexWidth = 2*R; const hexHeight = Math.sqrt(3)*R; const xStep = 1.5*R; const yStep = hexHeight; const centers=[]; const PAD=8; for(let r=0;r<rows;r++){ for(let c=0;c<cols;c++){ const x = c*xStep + R + PAD; const y = r*yStep + ((c&1)?(hexHeight/2):0) + R + PAD; centers.push({r,c,x,y}); } } const w = (cols-1)*xStep + hexWidth + PAD*2; const h = (rows-1)*yStep + hexHeight + PAD*2; return { centers, w, h }; }
function triCenter(rows, cols, side){ const trih = Math.sqrt(3)/2 * side; const PAD=8; const centers=[]; // interpret rows/cols as triangle cells
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      // place triangles in a rectangular array where orientation alternates
      const x = PAD + c * (side * 0.5) + (r % 2 ? side*0.25 : 0);
      const y = PAD + r * (trih * 0.5);
      centers.push({ r, c, x, y });
    }
  }
  const w = cols * side * 0.5 + PAD*2 + side;
  const h = rows * h * 0.5 + PAD*2 + h;
  return { centers, w, h };
}

// --- rendering pipeline using container scaling (simpler zoom) ---
function renderTiledBoard(){
  const svgRoot = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svgRoot || !container || !gameGrid || !tilingsCatalog) return;
  svgRoot.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const baseSize = Math.max(12, Math.floor(720 / Math.max(8, cols)));

  // read typed numeric controls
  const zoomTyped = Number((document.getElementById('zoomValue')||{value:1}).value || 1);
  const gapX = Number((document.getElementById('xGapValue')||{value:1}).value || 1);
  const gapY = Number((document.getElementById('yGapValue')||{value:1}).value || 1);
  debugEnabled = false;

  // container-based zoom: apply scale to .minefield-container via CSS transform
  const zoomScale = Math.max(0.05, Math.min(8, zoomTyped));
  container.style.transform = `scale(${zoomScale})`;

  // gaps expressed in tile units so they'll be visual after scaling; we still compute offsets in raw coords
  const gapUnitX = (gapX - 1) * baseSize * 0.45;
  const gapUnitY = (gapY - 1) * baseSize * 0.42;
  const colCenter = (cols - 1) / 2;

  // pick tiling
  const tiling = tilingsCatalog.tilings.find(t => t.id === currentTiling) || tilingsCatalog.tilings[0];
  const adjacencyDef = tiling.adjacencies[currentAdjacency] || Object.values(tiling.adjacencies)[0];

  // compute positions and render using simple center helpers
  if (tiling.id === 'square'){
    const centersInfo = squareCenter(rows, cols, baseSize);
    const viewW = centersInfo.w + Math.abs(gapUnitX) * cols;
    const viewH = centersInfo.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);

    for (const cellInfo of centersInfo.centers){
      const r = cellInfo.r, c = cellInfo.c;
      const cx = cellInfo.x + (c - colCenter) * gapUnitX;
      const cy = cellInfo.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeSquarePolygon(cx, cy, baseSize);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.5, 'stroke-linejoin':'round', fill:'rgba(2,10,20,0.9)' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(10, baseSize * 0.45);
      const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor':'middle', 'font-size': fontSize });
      if (cell.revealed) {
        if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
        else label.textContent='';
      } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

      (function(r,c){
        poly.addEventListener('click', ()=> {
          if (!running) return;
          if (gameGrid.cells[idx(rows,cols,r,c)].revealed && gameGrid.cells[idx(rows,cols,r,c)].count > 0){
            const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
            if (flagged === gameGrid.cells[idx(rows,cols,r,c)].count){
              const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
              let exploded=false;
              for (const [ar,ac] of toReveal){ const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency); if (res.exploded) exploded=true; }
              if (exploded){ running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — chord reveal'; }
              renderTiledBoard(); return;
            }
          }
          if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
          const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
          if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard();
        });
        poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
      })(cellInfo.r,cellInfo.c);

      svgRoot.appendChild(poly);
      svgRoot.appendChild(label);
    }
    return;
  }

  if (tiling.id === 'hex'){
    const centersInfo = hexCenter(rows, cols, baseSize/2);
    const viewW = centersInfo.w + Math.abs(gapUnitX) * cols;
    const viewH = centersInfo.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);

    for (const cellInfo of centersInfo.centers){
      const r = cellInfo.r, c = cellInfo.c;
      const cx = cellInfo.x + (c - colCenter) * gapUnitX;
      const cy = cellInfo.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeHexPolygon(cx, cy, baseSize/2);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.5, 'stroke-linejoin':'round', fill:'rgba(2,10,20,0.9)' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(9, baseSize * 0.36);
      const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor':'middle', 'font-size': fontSize });
      if (cell.revealed) {
        if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
        else label.textContent='';
      } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

      (function(r,c){
        poly.addEventListener('click', ()=> {
          if (!running) return;
          if (gameGrid.cells[idx(rows,cols,r,c)].revealed && gameGrid.cells[idx(rows,cols,r,c)].count > 0){
            const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
            if (flagged === gameGrid.cells[idx(rows,cols,r,c)].count){
              const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
              let exploded=false;
              for (const [ar,ac] of toReveal){ const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency); if (res.exploded) exploded=true; }
              if (exploded){ running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — chord reveal'; }
              renderTiledBoard(); return;
            }
          }
          if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
          const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
          if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard();
        });
        poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
      })(cellInfo.r,cellInfo.c);

      svgRoot.appendChild(poly);
      svgRoot.appendChild(label);
    }
    return;
  }

  if (tiling.id === 'triangle_equi'){
    const centersInfo = triCenter(rows, cols, baseSize);
    const viewW = centersInfo.w + Math.abs(gapUnitX) * cols;
    const viewH = centersInfo.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);

    for (const cellInfo of centersInfo.centers){
      const r = cellInfo.r, c = cellInfo.c;
      // compute proper triangle vertices around this center using side length baseSize
      const side = baseSize;
      const h = Math.sqrt(3)/2 * side;
      const up = ((r + c) % 2) === 0;
      // compute a canonical centroid and vertices anchored to cellInfo.x,y
      const cx = cellInfo.x + (c - colCenter) * gapUnitX;
      const cy = cellInfo.y + (r / Math.max(1, rows-1)) * gapUnitY;

      // build a small equilateral triangle centered roughly at cx,cy
      // simpler approach: place triangle based on orientation
      let points;
      if (up){
        points = [
          [cx, cy - (2/3)*h],
          [cx - side/2, cy + (1/3)*h],
          [cx + side/2, cy + (1/3)*h]
        ];
      } else {
        points = [
          [cx, cy + (2/3)*h],
          [cx - side/2, cy - (1/3)*h],
          [cx + side/2, cy - (1/3)*h]
        ];
      }

      const poly = makeSvgElement('polygon', { points: pointsToStr(points), stroke:'var(--accent)', 'stroke-width':1.5, 'stroke-linejoin':'round', fill:'rgba(4,18,30,0.92)' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','rgba(18,44,60,0.95)');
      if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

      const fontSize = Math.max(8, baseSize * 0.36);
      const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor':'middle', 'font-size': fontSize });
      if (cell.revealed) {
        if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
        else label.textContent='';
      } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

      (function(r,c){
        poly.addEventListener('click', ()=> {
          if (!running) return;
          if (gameGrid.cells[idx(rows,cols,r,c)].revealed && gameGrid.cells[idx(rows,cols,r,c)].count > 0){
            const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
            if (flagged === gameGrid.cells[idx(rows,cols,r,c)].count){
              const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
              let exploded=false;
              for (const [ar,ac] of toReveal){ const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency); if (res.exploded) exploded=true; }
              if (exploded){ running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — chord reveal'; }
              renderTiledBoard(); return;
            }
          }
          if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
          const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
          if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard();
        });
        poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
      })(cellInfo.r,cellInfo.c);

      svgRoot.appendChild(poly);
      svgRoot.appendChild(label);
    }
    return;
  }

  // fallback - same as square
  const centersInfo = squareCenter(rows, cols, baseSize);
  const viewW = centersInfo.w + Math.abs(gapUnitX) * cols;
  const viewH = centersInfo.h + Math.abs(gapUnitY) * rows;
  svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svgRoot.setAttribute('width', viewW);
  svgRoot.setAttribute('height', viewH);
  // render as square if unknown
  for (const cellInfo of centersInfo.centers){
    const r = cellInfo.r, c = cellInfo.c;
    const cx = cellInfo.x + (c - colCenter) * gapUnitX;
    const cy = cellInfo.y + (r / Math.max(1, rows-1)) * gapUnitY;
    const pts = computeSquarePolygon(cx, cy, baseSize);
    const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.5, 'stroke-linejoin':'round', fill:'rgba(2,10,20,0.9)' });
    const cell = gameGrid.cells[idx(rows,cols,r,c)];
    if (cell.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
    if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
    if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
    const fontSize = Math.max(10, baseSize * 0.45);
    const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor':'middle', 'font-size': fontSize });
    if (cell.revealed) {
      if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
      else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
      else label.textContent='';
    } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

    (function(r,c){
      poly.addEventListener('click', ()=> {
        if (!running) return;
        if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
        const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
        if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
        else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
        renderTiledBoard();
      });
      poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
    })(cellInfo.r,cellInfo.c);

    svgRoot.appendChild(poly);
    svgRoot.appendChild(label);
  }
}

// --- controls, wiring and initialization ---
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:9}).value || 9));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:9}).value || 9));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows, cols);
  running = true; firstClick = true;
  const statusEl = document.getElementById('msStatus'); if (statusEl) statusEl.textContent = 'Ready — first click is safe';

  currentTiling = (document.getElementById('tilingSelect')||{}).value || (tilingsCatalog && tilingsCatalog.tilings[0] && tilingsCatalog.tilings[0].id);
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || (tilingsCatalog && tilingsCatalog.tilings[0] && Object.keys(tilingsCatalog.tilings[0].adjacencies)[0]);

  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
  renderTiledBoard();
  try { window.gameGrid = gameGrid; window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
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
    renderTiledBoard();
  });

  adjSel.addEventListener('change', ()=> {
    currentAdjacency = adjSel.value;
    renderTiledBoard();
  });

  // set defaults
  sel.value = tilingsCatalog.tilings[0].id;
  populateAdj(sel.value);
  currentTiling = sel.value;
  currentAdjacency = adjSel.value;
}

function wireControls(){
  const newBtn = document.getElementById('newGame');
  if (newBtn){ newBtn.removeEventListener('click', startNewGame); newBtn.addEventListener('click', startNewGame); }

  // sync typed fields with sliders (if you later want sliders)
  const zoomValue = document.getElementById('zoomValue'); const xGap = document.getElementById('xGapValue'); const yGap = document.getElementById('yGapValue');
  if (zoomValue) zoomValue.addEventListener('blur', ()=> { let v=Number(zoomValue.value); if (Number.isNaN(v)) v = 1; zoomValue.value = Number(v).toFixed(2); renderTiledBoard(); });
  if (xGap) xGap.addEventListener('blur', ()=> { let v=Number(xGap.value); if (Number.isNaN(v)) v = 1; xGap.value = Number(v).toFixed(2); renderTiledBoard(); });
  if (yGap) yGap.addEventListener('blur', ()=> { let v=Number(yGap.value); if (Number.isNaN(v)) v = 1; yGap.value = Number(v).toFixed(2); renderTiledBoard(); });

  document.getElementById('msRows').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msCols').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msMines').addEventListener('change', ()=> renderTiledBoard());
}

// --- load tilings.json then init ---
function loadTilingsAndInit(){
  fetch(TILINGS_URL).then(r => {
    if (!r.ok) throw new Error('tilings.json load failed');
    return r.json();
  }).then(data => {
    tilingsCatalog = data;
    populateTilingControls();
    wireControls();
    startNewGame();
  }).catch(err => {
    console.error('tilings load error', err);
    // fallback minimal catalog if fetch fails
    tilingsCatalog = {
      tilings: [
        { id:'square', name:'Square', adjacencies:{ edges4:{label:'Von Neumann (4)', type:'offsets', offsets:[[-1,0],[1,0],[0,-1],[0,1]]}, all8:{label:'All 8', type:'offsets', offsets:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]} } }
      ]
    };
    populateTilingControls();
    wireControls();
    startNewGame();
  });
}

document.addEventListener('DOMContentLoaded', loadTilingsAndInit);
