// app.js
// Sections: state, utils, adjacency, geometry, render, game logic, controls, zoom/pan, init

const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let gameGrid = null;
let running = false;
let firstClick = true;
let currentAdjacency = 'all8';

const view = { scale: 0.6, tx: 0, ty: 0 };

// utils
function idx(rows, cols, r, c){ return r * cols + c; }
function inBounds(rows, cols, r, c){ return r >= 0 && r < rows && c >= 0 && c < cols; }
function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// adjacency
function squareOffsets(r,c,adj){
  return adj === 'edges4'
    ? [[-1,0],[1,0],[0,-1],[0,1]]
    : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
}

// geometry helpers
function squareCenter(rows, cols, side){
  const PAD = 12;
  const centers = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const x = PAD + c*side + side/2;
      const y = PAD + r*side + side/2;
      centers.push({ r, c, x, y });
    }
  }
  return { centers, w: PAD*2 + cols*side, h: PAD*2 + rows*side };
}

// svg helpers
function makeSvg(tag, attrs = {}){
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}
function polyPoints(pts){ return pts.map(p => `${p[0]},${p[1]}`).join(' '); }

// render
function renderBoard(){
  const svg = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svg || !container || !gameGrid) return;
  svg.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const side = Math.max(14, Math.floor(900 / Math.max(12, cols)));
  const info = squareCenter(rows, cols, side);

  svg.setAttribute('viewBox', `0 0 ${info.w} ${info.h}`);
  svg.setAttribute('width', info.w);
  svg.setAttribute('height', info.h);

  for (const cell of info.centers){
    const r = cell.r, c = cell.c, cx = cell.x, cy = cell.y;
    const s = side / 2;
    const pts = [[cx-s, cy-s],[cx+s, cy-s],[cx+s, cy+s],[cx-s, cy+s]];

    const poly = makeSvg('polygon', {
      points: polyPoints(pts),
      stroke: 'var(--accent)',
      'stroke-width': 1.25,
      fill: 'rgba(2,10,20,0.9)',
      style: 'cursor:pointer'
    });

    const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
    if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
    if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
    if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

    const fontSize = Math.max(11, Math.floor(side * 0.45));
    const label = makeSvg('text', {
      x: cx,
      y: cy + Math.floor(fontSize * 0.35),
      'text-anchor': 'middle',
      'font-size': fontSize,
      style: 'pointer-events:none; user-select:none'
    });

    if (cellObj.revealed){
      if (cellObj.mine){ label.textContent = '💣'; label.setAttribute('fill','#fff'); }
      else if (cellObj.count > 0){ label.textContent = String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
    } else if (cellObj.flagged){ label.textContent = '🚩'; label.setAttribute('fill','#ffb86b'); }

    attachHandlers(poly, r, c);
    svg.appendChild(poly);
    svg.appendChild(label);
  }

  // apply frame-level transform (pan & zoom)
  container.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  container.style.transformOrigin = 'center center';
}

// game logic
function computeCounts(grid, adjacency){
  const { rows, cols, cells } = grid;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count = -1; continue; }
      const offsets = squareOffsets(r,c,adjacency);
      let cnt = 0;
      for (const [dr,dc] of offsets){
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rows,cols,rr,cc)) continue;
        if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
      }
      cells[i].count = cnt;
    }
  }
}

function placeMines(grid, mineCount, safe){
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine=false; cell.revealed=false; cell.flagged=false; cell.count=0; });
  const total = rows * cols;
  const perm = Array.from({length:total}, (_,i) => i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safe){
    const [sr,sc] = safe;
    forbidden.add(idx(rows,cols,sr,sc));
    for (const [dr,dc] of squareOffsets(sr,sc,currentAdjacency)){
      const rr = sr + dr, cc = sc + dc;
      if (inBounds(rows,cols,rr,cc)) forbidden.add(idx(rows,cols,rr,cc));
    }
  }

  let placed = 0, k = 0, maxPlace = Math.min(mineCount, total - 1);
  while (placed < maxPlace && k < total){
    const pos = perm[k++];
    if (forbidden.has(pos)) continue;
    cells[pos].mine = true; placed++;
  }
  computeCounts(grid, currentAdjacency);
}

// reveal / flag
function revealCell(grid, r, c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded:false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed: [], exploded:false };
  if (cell.mine){ cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed = [];
  const stack = [[r,c]];
  while (stack.length){
    const [rr,cc] = stack.pop();
    const ii = idx(rows,cols,rr,cc);
    const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed = true;
    changed.push([rr,cc]);
    if (cl.count === 0){
      for (const [dr,dc] of squareOffsets(rr,cc,currentAdjacency)){
        const nr = rr + dr, nc = cc + dc;
        if (!inBounds(rows,cols,nr,nc)) continue;
        const ni = idx(rows,cols,nr,nc);
        if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]);
      }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid, r, c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return null;
  const i = idx(rows,cols,r,c); const cell = cells[i];
  if (!cell || cell.revealed) return null;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}
function checkWin(grid){
  return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed));
}
function countFlaggedNeighbors(grid, r, c){
  const offsets = squareOffsets(r, c, currentAdjacency);
  let count = 0;
  for (const [dr,dc] of offsets){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) count++;
  }
  return count;
}

// handlers
function attachHandlers(el, r, c){
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!running) return;

    // chord behavior: if this cell is revealed and numbered, and flagged count matches, reveal neighbors
    const cellObjNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, r, c)];
    if (cellObjNow.revealed && cellObjNow.count > 0){
      const flagged = countFlaggedNeighbors(gameGrid, r, c);
      if (flagged === cellObjNow.count){
        let exploded = false;
        for (const [dr,dc] of squareOffsets(r,c,currentAdjacency)){
          const rr = r + dr, cc = c + dc;
          if (!inBounds(gameGrid.rows, gameGrid.cols, rr, cc)) continue;
          const neigh = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, rr, cc)];
          if (!neigh.flagged && !neigh.revealed){
            const res = revealCell(gameGrid, rr, cc);
            if (res.exploded) exploded = true;
          }
        }
        if (exploded){
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'BOOM';
        } else {
          if (checkWin(gameGrid)){ running = false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; }
        }
        renderBoard();
        return;
      }
      // if flagged count doesn't match, allow a normal click below (no-op because it's revealed)
      return;
    }

    if (firstClick){
      const mines = Math.max(1, Number((document.getElementById('msMines')||{value:40}).value || 40));
      placeMines(gameGrid, mines, [r,c]);
      firstClick = false;
    }
    const res = revealCell(gameGrid, r, c);
    if (res.exploded){
      running = false;
      gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
      const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'BOOM';
    } else {
      const ms = document.getElementById('msStatus');
      if (checkWin(gameGrid)){ running = false; if (ms) ms.textContent = 'You win!'; }
      else if (ms) ms.textContent = 'Playing...';
    }
    renderBoard();
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!running) return;
    toggleFlag(gameGrid, r, c);
    if (checkWin(gameGrid)){ running = false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; }
    renderBoard();
  });
}

// controls
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:12}).value || 12));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:16}).value || 16));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:40}).value || 40));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows, cols);
  running = true; firstClick = true;
  const statusEl = document.getElementById('msStatus'); if (statusEl) statusEl.textContent = 'Ready — first click is safe';
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || 'all8';
  renderBoard();
}

function wireControls(){
  const newBtn = document.getElementById('newGame');
  if (newBtn){ newBtn.removeEventListener('click', startNewGame); newBtn.addEventListener('click', startNewGame); }

  const adj = document.getElementById('adjacencySelect');
  if (adj) adj.addEventListener('change', ()=>{
    currentAdjacency = adj.value;
    if (gameGrid) computeCounts(gameGrid, currentAdjacency);
    renderBoard();
  });

  const theme = document.getElementById('themeSelect');
  if (theme) theme.addEventListener('change', ()=>{
    document.body.setAttribute('data-theme', theme.value || 'dark-ocean');
    renderBoard();
  });
}

// zoom & pan (frame-level) with click-tolerance + delayed capture
function setupZoomPan(){
  const frame = document.getElementById('minefieldFrame');
  const container = document.getElementById('minefieldContainer');
  if (!frame || !container) return;

  view.scale = 0.6; view.tx = 0; view.ty = 0;
  renderBoard();

  // pan with small movement threshold so clicks still register
  let dragging = false;
  let maybeDrag = null; // { pointerId, startX, startY, startTx, startTy }
  const DRAG_THRESHOLD = 6;

  frame.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    maybeDrag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startTx: view.tx, startTy: view.ty };
    // don't capture yet; capture only after we detect a real drag
  });

  frame.addEventListener('pointermove', (e) => {
    if (maybeDrag && maybeDrag.pointerId === e.pointerId && !dragging){
      const dx = e.clientX - maybeDrag.startX;
      const dy = e.clientY - maybeDrag.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD){
        dragging = true;
        frame.setPointerCapture && frame.setPointerCapture(e.pointerId); // capture once dragging starts
      } else {
        return; // not past threshold, allow clicks to register
      }
    }
    if (dragging && maybeDrag && maybeDrag.pointerId === e.pointerId){
      const dx = e.clientX - maybeDrag.startX;
      const dy = e.clientY - maybeDrag.startY;
      view.tx = maybeDrag.startTx + dx;
      view.ty = maybeDrag.startTy + dy;
      renderBoard();
    }
  });

  function endPointer(e){
    if (maybeDrag && maybeDrag.pointerId === e.pointerId){
      dragging = false;
      maybeDrag = null;
      frame.releasePointerCapture && frame.releasePointerCapture(e.pointerId);
    }
  }
  frame.addEventListener('pointerup', endPointer);
  frame.addEventListener('pointercancel', endPointer);
  frame.addEventListener('pointerleave', endPointer);

  // two-pointer pinch (trackpad and touch)
  const pointers = new Map();
  function dist(a,b){ const dx = b.clientX - a.clientX, dy = b.clientY - a.clientY; return Math.hypot(dx, dy); }

  frame.addEventListener('pointerdown', e => pointers.set(e.pointerId, e));
  frame.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2){
      const it = pointers.values(); const a = it.next().value, b = it.next().value;
      const d = dist(a,b);
      if (frame._lastD == null) frame._lastD = d;
      const ratio = d / frame._lastD;
      frame._lastD = d;
      view.scale = Math.max(0.1, Math.min(6, view.scale * ratio));
      renderBoard();
    }
  });
  function clearPointer(e){ pointers.delete(e.pointerId); frame._lastD = null; }
  frame.addEventListener('pointerup', clearPointer);
  frame.addEventListener('pointercancel', clearPointer);
  frame.addEventListener('pointerout', clearPointer);
  frame.addEventListener('pointerleave', clearPointer);

  // wheel zoom anywhere in frame (vertical scroll -> zoom)
  frame.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)){
      const delta = -e.deltaY;
      const factor = 1 + Math.sign(delta) * Math.min(0.14, Math.abs(delta) / 600);
      view.scale = Math.max(0.1, Math.min(6, view.scale * factor));
      e.preventDefault();
      renderBoard();
      return;
    }
  }, { passive:false });

  // keyboard shortcuts
  frame.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '='){ view.scale = Math.min(6, view.scale * 1.12); renderBoard(); }
    if (e.key === '-' || e.key === '_'){ view.scale = Math.max(0.1, view.scale / 1.12); renderBoard(); }
    if (e.key === '0'){ view.scale = 1; view.tx = 0; view.ty = 0; renderBoard(); }
  });
}

// init
function init(){
  wireControls();
  setupZoomPan();
  startNewGame();
}
document.addEventListener('DOMContentLoaded', init);
