// app.js — Minesweeper with: Square, Hex, Right-Triangle, Equilateral-Triangle (true alternating up/down)
// Expects HTML IDs: appRoot, msRows, msCols, msMines, tilingSelect, adjacencySelect, applyAdjacency, newGame, msStatus
// Optional sliders: triShrinkSlider, triShrinkValue

// --- TILINGS + adjacency presets ---
const TILINGS = {
  square: {
    label: "Square",
    adjacencies: {
      "square-8":  { label: "Square 8 (all 8)", offsets: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] },
      "von-neumann":{ label: "Von Neumann (4)", offsets: [[-1,0],[1,0],[0,-1],[0,1]] }
    }
  },

  triangle_right: {
    label: "Right Triangle",
    adjacencies: {
      "triR-edge": { label: "Right-tri edge neighbors", offsets: null },
      "triR-r2":   { label: "Right-tri radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  triangle_equi: {
    label: "Equilateral Triangle",
    adjacencies: {
      "triE-edge": { label: "Edges (3)", offsets: null },
      "triE-edge+v": { label: "Edges + vertices (6)", offsets: null },
      "triE-r2": { label: "Radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  hex: {
    label: "Hexagon",
    adjacencies: {
      "hex-6": { label: "Hex 6 (standard)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] }
    }
  }
};

// --- Visual constants ---
const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

// --- Module-scoped state ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;

// --- Small utilities ---
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

// --- Adjacency helpers ---
function triangleRightOffsets(r,c,adjKey){
  // orientation: parity determines which right triangle orientation
  const rightPointing = ((r + c) % 2) === 0;
  if (adjKey === 'triR-edge') return rightPointing ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  // fallback radius
  const arr=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
}

function triangleEquiOffsets(r,c,adjKey){
  // For equilateral alternate up/down triangles
  const up = ((r + c) % 2) === 0;
  if (adjKey === 'triE-edge') return up ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  if (adjKey === 'triE-edge+v') {
    return up ? [[0,-1],[-1,0],[1,0],[0,1],[-1,1],[1,-1]] : [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,1]];
  }
  const arr=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
}

function getOffsetsFor(tilingKey, adjacencyKey){
  if (tilingKey === 'triangle_right' || tilingKey === 'triangle_equi') return null;
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

// --- Grid API ---
function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (tilingKey === 'triangle_right') {
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const i = idx(rows,cols,r,c);
        if (cells[i].mine) { cells[i].count = -1; continue; }
        const offs = triangleRightOffsets(r,c,adjacencyKey);
        let cnt = 0;
        for (const [dr,dc] of offs) {
          const rr = r + dr, cc = c + dc;
          if (!inBounds(rows,cols,rr,cc)) continue;
          if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
        }
        cells[i].count = cnt;
      }
    }
    return;
  }

  if (tilingKey === 'triangle_equi') {
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const i = idx(rows,cols,r,c);
        if (cells[i].mine) { cells[i].count = -1; continue; }
        const offs = triangleEquiOffsets(r,c,adjacencyKey);
        let cnt = 0;
        for (const [dr,dc] of offs) {
          const rr = r + dr, cc = c + dc;
          if (!inBounds(rows,cols,rr,cc)) continue;
          if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
        }
        cells[i].count = cnt;
      }
    }
    return;
  }

  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }
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

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine = false; cell.count = 0; cell.revealed = false; cell.flagged = false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  for (let i = total - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr, sc] = safeCell;
    let offs = [];
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else offs = getOffsetsFor(tilingKey, adjacencyKey).concat([[0,0]]);
    for (const [dr,dc] of offs){ const rr = sr + dr, cc = sc + dc; if (!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
  }

  let placed = 0, k = 0;
  const maxPlace = Math.min(mineCount, total - 1);
  while (placed < maxPlace && k < total) {
    const pos = perm[k++];
    if (forbidden.has(pos)) continue;
    cells[pos].mine = true;
    placed++;
  }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingKey, adjacencyKey);
}

// --- Reveal / flagging / chord ---
function revealCell(grid, r, c, tilingKey, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded: false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed: [], exploded: false };
  if (cell.mine) { cell.revealed = true; return { changed: [[r,c]], exploded: true }; }

  const changed = [];
  const stack = [[r,c]];
  while (stack.length){
    const [rr,cc] = stack.pop();
    const ii = idx(rows,cols,rr,cc);
    const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed = true; changed.push([rr,cc]);

    let offs;
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(rr,cc,adjacencyKey);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(rr,cc,adjacencyKey);
    else offs = getOffsetsFor(tilingKey, adjacencyKey);

    if (cl.count === 0){
      for (const [dr,dc] of offs){
        const nr = rr + dr, nc = cc + dc;
        if (!inBounds(rows,cols,nr,nc)) continue;
        const ni = idx(rows,cols,nr,nc);
        if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]);
      }
    }
  }
  return { changed, exploded: false };
}

function toggleFlag(grid,r,c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return null;
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed) return null;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}

function countFlaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){
  let offs;
  if (tilingKey === 'triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey);
  else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  let cnt = 0;
  for (const [dr,dc] of offs){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) cnt++;
  }
  return cnt;
}

function revealUnflaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){
  let offs;
  if (tilingKey === 'triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey);
  else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  const toReveal = [];
  for (const [dr,dc] of offs){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    const cell = grid.cells[idx(grid.rows, grid.cols, rr, cc)];
    if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]);
  }
  return toReveal;
}

function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// --- SVG helpers ---
function makeSvgElement(tag, attrs={}) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points) { return points.map(p => `${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx,cy,size){ const s = size/2; return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]]; }
function computeHexPolygon(cx,cy,radius,gapPx=1.0){ const visualR = Math.max(1, radius - gapPx); const pts = []; for (let k=0;k<6;k++){ const angle = k*Math.PI/3; pts.push([cx + visualR*Math.cos(angle), cy + visualR*Math.sin(angle)]); } return pts; }

// --- Vertex lattice builders ---
// Right-triangle lattice: subdivide square grid into two right triangles per square cell.
// We will place vertices at square lattice (step = s/1) and map each cell to one triangle oriented by parity.
function buildRightTriangleLattice(rows, cols, s, PAD = 8){
  const step = s;
  const vrows = rows + 1;
  const vcols = cols + 1;
  const vertices = [];
  for (let vr=0; vr<vrows; vr++){
    for (let vc=0; vc<vcols; vc++){
      const x = PAD + vc * step;
      const y = PAD + vr * step;
      vertices.push({ x, y, vr, vc });
    }
  }
  const vIndex = (vr,vc) => vr * vcols + vc;
  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const parity = ((r + c) % 2) === 0;
      if (parity) {
        // right-pointing style (choose consistent ordering)
        triIndex.push({ r, c, upward: true, verts: [ vIndex(r, c), vIndex(r+1, c), vIndex(r, c+1) ] });
      } else {
        triIndex.push({ r, c, upward: false, verts: [ vIndex(r+1, c+1), vIndex(r+1, c), vIndex(r, c+1) ] });
      }
    }
  }
  const lastV = vertices[vertices.length-1];
  const w = lastV ? lastV.x + PAD : (cols * step + PAD*2);
  const h = lastV ? lastV.y + PAD : (rows * step + PAD*2);
  return { vertices, triIndex, w, h };
}

// Equilateral triangle lattice (true alternating up/down equilateral tessellation).
// Vertex rows separated by h = sqrt(3)/2 * s, horizontal step between adjacent vertex positions = s/2.
// Each triangle cell (r,c) maps to three shared vertices; triangles alternate up/down by parity.
function buildEquilateralVertexLattice(rows, cols, s, PAD = 8){
  const h = Math.sqrt(3) / 2 * s;
  const vertexRows = rows + 1;
  const vertexCols = cols * 2 + 1; // enough columns for half-step indexing
  const vertices = [];
  for (let vr=0; vr<vertexRows; vr++){
    const y = PAD + vr * h;
    const rowOffset = (vr % 2) ? s/2 : 0;
    for (let vc=0; vc<vertexCols; vc++){
      const x = PAD + rowOffset + vc * (s/2);
      vertices.push({ x, y, vr, vc });
    }
  }

  const vCols = vertexCols;
  const vIndex = (vr, vc) => {
    const vrC = Math.max(0, Math.min(vertexRows-1, vr));
    const vcC = Math.max(0, Math.min(vCols-1, vc));
    return vrC * vCols + vcC;
  };

  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const vr = r;
      const baseVc = c * 2;
      const up = ((r + c) % 2) === 0;
      if (up) {
        triIndex.push({ r, c, upward: true, verts: [ vIndex(vr, baseVc+1), vIndex(vr+1, baseVc), vIndex(vr+1, baseVc+2) ] });
      } else {
        triIndex.push({ r, c, upward: false, verts: [ vIndex(vr+1, baseVc+1), vIndex(vr, baseVc), vIndex(vr, baseVc+2) ] });
      }
    }
  }

  const lastV = vertices[vertices.length-1];
  const w = lastV ? lastV.x + s/2 + PAD : (cols * s + PAD*2);
  const H = (vertexRows - 1) * h + PAD*2 + h;
  return { vertices, triIndex, w, h: H };
}

// shrink function to move vertices toward centroid for optional visual gap (set to 0 for none)
function shrinkTriangleVertices(vertsPts, shrinkPx = 0){
  if (!shrinkPx) return vertsPts.map(v => [v.x, v.y]);
  const cx = (vertsPts[0].x + vertsPts[1].x + vertsPts[2].x) / 3;
  const cy = (vertsPts[0].y + vertsPts[1].y + vertsPts[2].y) / 3;
  return vertsPts.map(v => {
    const vx = cx - v.x, vy = cy - v.y;
    const dist = Math.sqrt(vx*vx + vy*vy) || 1;
    const t = Math.min(1, shrinkPx / dist);
    return [ v.x + vx * t, v.y + vy * t ];
  });
}

// --- Rendering / UI ---
function renderTiledBoard(){
  const appRoot = document.getElementById('appRoot');
  if (!appRoot || !gameGrid) return;
  appRoot.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const requestedCols = Math.max(1, cols);
  const rawBase = Math.floor(720 / Math.max(8, requestedCols));
  const baseSize = Math.max(12, Math.min(56, rawBase));
  const triShrinkVal = Number((document.getElementById('triShrinkSlider')||{value:0}).value || 0);
  const shrinkPx = Math.max(0, triShrinkVal);

  const tileType = currentTiling || 'square';

  if (tileType === 'triangle_equi'){
    const PAD = 8;
    const lattice = buildEquilateralVertexLattice(rows, cols, baseSize, PAD);
    const { vertices, triIndex, w: svgW, h: svgH } = lattice;
    const svg = makeSvgElement('svg', { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}` });
    svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

    for (const ti of triIndex){
      const r = ti.r, c = ti.c;
      const vertsPts = ti.verts.map(i => vertices[i] || { x:0, y:0 });
      const pts = shrinkTriangleVertices(vertsPts, shrinkPx);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke: '#0ea5b3', 'stroke-width': 1, 'stroke-linejoin': 'round', fill: '#022' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','#032');
      if (cell.flagged) poly.setAttribute('fill','#041');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
      poly.classList.add('tile');

      const lx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const ly = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 + 4;
      const label = makeSvgElement('text', { x: lx, y: ly, 'text-anchor':'middle', 'font-size': Math.max(10, baseSize/3), 'pointer-events':'none' });

      if (cell.revealed) {
        if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill', '#fff'); }
        else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
        else label.textContent = '';
      } else if (cell.flagged) { label.textContent = '🚩'; label.setAttribute('fill', '#ffb86b'); }
      else label.textContent = '';

      poly.addEventListener('click', ()=> {
        if (!running) return;
        if (firstClick) {
          const minesVal = Number((document.getElementById('msMines')||{value:10}).value || 10);
          placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, r, c, currentTiling, currentAdjacency);
        if (res.exploded) {
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
          else { const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'Playing...'; }
        }
        renderTiledBoard();
      });

      poly.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        toggleFlag(gameGrid, r, c);
        if (checkWin(gameGrid)) { running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
        renderTiledBoard();
      });

      svg.appendChild(poly);
      svg.appendChild(label);
    }

    appRoot.appendChild(svg);
    return;
  }

  if (tileType === 'triangle_right'){
    const PAD = 8;
    const lattice = buildRightTriangleLattice(rows, cols, baseSize, PAD);
    const { vertices, triIndex, w: svgW, h: svgH } = lattice;
    const svg = makeSvgElement('svg', { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}` });
    svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

    const triShrinkValLocal = shrinkPx; // reuse same control
    for (const ti of triIndex){
      const r = ti.r, c = ti.c;
      const vertsPts = ti.verts.map(i => vertices[i] || { x:0, y:0 });
      const pts = shrinkTriangleVertices(vertsPts, triShrinkValLocal);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke: '#0ea5b3', 'stroke-width': 1, 'stroke-linejoin': 'round', fill: '#022' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','#032');
      if (cell.flagged) poly.setAttribute('fill','#041');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
      poly.classList.add('tile');

      const lx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const ly = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 + 4;
      const label = makeSvgElement('text', { x: lx, y: ly, 'text-anchor':'middle', 'font-size': Math.max(10, baseSize/3), 'pointer-events':'none' });

      if (cell.revealed) {
        if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill', '#fff'); }
        else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
        else label.textContent = '';
      } else if (cell.flagged) { label.textContent = '🚩'; label.setAttribute('fill', '#ffb86b'); }
      else label.textContent = '';

      poly.addEventListener('click', ()=> {
        if (!running) return;
        if (firstClick) {
          const minesVal = Number((document.getElementById('msMines')||{value:10}).value || 10);
          placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, r, c, currentTiling, currentAdjacency);
        if (res.exploded) {
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
          else { const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'Playing...'; }
        }
        renderTiledBoard();
      });

      poly.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        toggleFlag(gameGrid, r, c);
        if (checkWin(gameGrid)) { running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
        renderTiledBoard();
      });

      svg.appendChild(poly);
      svg.appendChild(label);
    }

    appRoot.appendChild(svg);
    return;
  }

  // Hex or Square (center-based)
  let centersInfo;
  if (tileType === 'hex') centersInfo = hexCenter(rows, cols, baseSize / 2);
  else centersInfo = squareCenter(rows, cols, baseSize);

  const svg = makeSvgElement('svg', { width: centersInfo.w, height: centersInfo.h, viewBox: `0 0 ${centersInfo.w} ${centersInfo.h}` });
  svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

  for (const cellInfo of centersInfo.centers){
    const r = cellInfo.r, c = cellInfo.c;
    const cx = cellInfo.x, cy = cellInfo.y;
    let pts;
    if (tileType === 'hex') pts = computeHexPolygon(cx, cy, baseSize/2, 1.0);
    else pts = computeSquarePolygon(cx, cy, baseSize);

    const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke: '#0ea5b3', 'stroke-width': 1, 'stroke-linejoin': 'round', fill: '#022' });
    const cell = gameGrid.cells[idx(rows,cols,r,c)];
    if (cell.revealed) poly.setAttribute('fill','#032');
    if (cell.flagged) poly.setAttribute('fill','#041');
    if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
    poly.classList.add('tile');

    const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor':'middle', 'font-size': Math.max(12, baseSize/3), 'pointer-events':'none' });
    if (cell.revealed) {
      if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill', '#fff'); }
      else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
      else label.textContent = '';
    } else if (cell.flagged) { label.textContent = '🚩'; label.setAttribute('fill', '#ffb86b'); }
    else label.textContent = '';

    poly.addEventListener('click', ()=> {
      if (!running) return;
      if (cell.revealed && cell.count > 0) {
        const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
        if (flagged === cell.count) {
          const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
          let exploded = false;
          for (const [ar,ac] of toReveal) { const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency); if (res.exploded) exploded = true; }
          if (exploded) { running = false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — a mine was revealed during chord'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard(); return;
        }
        return;
      }

      if (firstClick) { const minesVal = Number((document.getElementById('msMines')||{value:10}).value || 10); placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]); firstClick = false; }
      const res = revealCell(gameGrid, r, c, currentTiling, currentAdjacency);
      if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
      else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
      renderTiledBoard();
    });

    poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid, r, c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });

    svg.appendChild(poly);
    svg.appendChild(label);
  }

  appRoot.appendChild(svg);
}

// square and hex center helpers
function squareCenter(rows, cols, size){ const PAD=8; const centers=[]; for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = c*size + size/2 + PAD; const y = r*size + size/2 + PAD; centers.push({r,c,x,y}); } return { centers, w: cols*size + 16, h: rows*size + 16 }; }
function hexCenter(rows, cols, radius){ const R = radius; const hexWidth = 2*R; const hexHeight = Math.sqrt(3)*R; const xStep = 1.5*R; const yStep = hexHeight; const centers=[]; const PAD=8; for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const x = c*xStep + R + PAD; const y = r*yStep + ((c&1)?(hexHeight/2):0) + R + PAD; centers.push({r,c,x,y}); } } const w = (cols-1)*xStep + hexWidth + PAD*2; const h = (rows-1)*yStep + hexHeight + PAD*2; return { centers, w, h }; }

// --- Controls / wiring ---
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:9}).value || 9));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:9}).value || 9));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows, cols, mines);
  running = true; firstClick = true;
  const statusEl = document.getElementById('msStatus'); if (statusEl) statusEl.textContent = 'Ready — first click is safe';

  currentTiling = (document.getElementById('tilingSelect')||{}).value || Object.keys(TILINGS)[0];
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || Object.keys(TILINGS[currentTiling].adjacencies)[0];

  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
  renderTiledBoard();
  try { window.gameGrid = gameGrid; window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; window.TILINGS = TILINGS; } catch(e){}
}

function populateTilingControls(){
  const sel = document.getElementById('tilingSelect'); const adjSel = document.getElementById('adjacencySelect'); if (!sel || !adjSel) return;
  sel.innerHTML = '';
  for (const key of Object.keys(TILINGS)){ const opt = document.createElement('option'); opt.value = key; opt.textContent = TILINGS[key].label; sel.appendChild(opt); }
  function populateAdj(tilingKey){ adjSel.innerHTML = ''; const adj = (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies) || {}; for (const aKey of Object.keys(adj)){ const o = document.createElement('option'); o.value = aKey; o.textContent = adj[aKey].label; adjSel.appendChild(o); } if (adjSel.options.length) adjSel.selectedIndex = 0; }
  const initial = sel.value || Object.keys(TILINGS)[0]; populateAdj(initial); currentTiling = initial; currentAdjacency = adjSel.value || (adjSel.options[0] && adjSel.options[0].value);

  sel.__robust_change_handler && sel.removeEventListener('change', sel.__robust_change_handler);
  adjSel.__robust_change_handler && adjSel.removeEventListener('change', adjSel.__robust_change_handler);

  const tilingHandler = function(e){
    const newTiling = (document.getElementById('tilingSelect')||{}).value || (e && e.target && e.target.value);
    populateAdj(newTiling); currentTiling = newTiling; currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || currentAdjacency;
    const statusEl = document.getElementById('msStatus');
    if (statusEl) {
      const label = (TILINGS[currentTiling] && TILINGS[currentTiling].label) || currentTiling;
      const adjLabel = (TILINGS[currentTiling] && TILINGS[currentTiling].adjacencies && TILINGS[currentTiling].adjacencies[currentAdjacency] && TILINGS[currentTiling].adjacencies[currentAdjacency].label) || currentAdjacency;
      statusEl.textContent = `Tiling: ${label} (Adjacency: ${adjLabel})`;
    }
    if (gameGrid && typeof computeCountsWithAdjacency === 'function') {
      try { computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); } catch (err) { console.error('Error on tiling change recompute:', err); startNewGame(); }
    } else startNewGame();
    try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  };
  sel.__robust_change_handler = tilingHandler; sel.addEventListener('change', tilingHandler);

  const adjacencyHandler = function(e){ currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || (e && e.target && e.target.value); try{ window.currentAdjacency = currentAdjacency; }catch(e){}; if (gameGrid) { try { computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); } catch(err) { console.error(err); } } };
  adjSel.__robust_change_handler = adjacencyHandler; adjSel.addEventListener('change', adjacencyHandler);
}

function applyAdjacencyAction(){ const sel=document.getElementById('tilingSelect'); const adjSel=document.getElementById('adjacencySelect'); if (!sel||!adjSel) return; currentTiling = sel.value; currentAdjacency = adjSel.value; try{ window.currentTiling=currentTiling; window.currentAdjacency=currentAdjacency; }catch(e){}; if (gameGrid){ computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); const ms=document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`; } }
function newGameAction(){ startNewGame(); }

// --- Init and slider wiring ---
function initOnceDomReady(){
  populateTilingControls();
  const applyBtn = document.getElementById('applyAdjacency'); const newBtn = document.getElementById('newGame');
  if (applyBtn) { applyBtn.removeEventListener('click', applyAdjacencyAction); applyBtn.addEventListener('click', applyAdjacencyAction); }
  if (newBtn) { newBtn.removeEventListener('click', newGameAction); newBtn.addEventListener('click', newGameAction); }

  const triSlider = document.getElementById('triShrinkSlider');
  if (triSlider) triSlider.addEventListener('input', (e)=> { const v=e.target.value; const el=document.getElementById('triShrinkValue'); if (el) el.textContent = v; renderTiledBoard(); });

  const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'Ready — select tiling and click New Game';
  startNewGame();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOnceDomReady); else setTimeout(initOnceDomReady, 0);
