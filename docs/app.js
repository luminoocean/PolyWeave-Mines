// app.js — Full Minesweeper with triangle vertex-lattice rendering
// Expects index.html to provide elements with IDs:
// appRoot, msRows, msCols, msMines, newGame, msStatus, tilingSelect, adjacencySelect, applyAdjacency
// Optional debug sliders expected after applyAdjacency in the DOM:
// xGapSlider, xGapValue, yGapSlider, yGapValue, triShrinkSlider, triShrinkValue

// --- TILINGS + adjacency presets ---
const TILINGS = {
  square: {
    label: "Square",
    adjacencies: {
      "square-8":  { label: "Square 8 (all 8)", offsets: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] },
      "von-neumann":{ label: "Von Neumann (4)", offsets: [[-1,0],[1,0],[0,-1],[0,1]] },
      "knight":     { label: "Knight moves", offsets: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] },
      "square-r2":  { label: "Square radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  triangle: {
    label: "Triangle",
    adjacencies: {
      "tri-edge": { label: "Triangle edge neighbors (3)", offsets: null },
      "tri-edge+v": { label: "Triangle edges+vertices (6)", offsets: null },
      "tri-r2": { label: "Triangle radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  hex: {
    label: "Hexagon",
    adjacencies: {
      "hex-6": { label: "Hex 6 (standard)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] },
      "hex-r2": { label: "Hex radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  }
};

// --- Visual constants ---
const NUMBER_COLORS = { 1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de' };

// --- Module-scoped state ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;

// --- Helpers ---
function idx(rows, cols, r, c) { return r * cols + c; }
function inBounds(rows, cols, r, c) { return r >= 0 && r < rows && c >= 0 && c < cols; }
function triangleOrientation(r, c) { return ((r + c) % 2) === 0; }

function triangleOffsetsForCell(r, c, adjKey) {
  const up = triangleOrientation(r,c);
  if (adjKey === 'tri-edge') {
    return up ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  }
  if (adjKey === 'tri-edge+v') {
    return up ? [[0,-1],[-1,0],[1,0],[0,1],[-1,1],[1,-1]]
              : [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,1]];
  }
  const arr = [];
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (!(dr===0&&dc===0)) arr.push([dr,dc]);
  return arr;
}

function getOffsetsFor(tilingKey, adjacencyKey) {
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) return null;
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

// --- Grid API ---
function createGrid(rows, cols, mines=0) {
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey) {
  const { rows, cols, cells } = grid;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) {
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const i = idx(rows,cols,r,c);
        if (cells[i].mine) { cells[i].count = -1; continue; }
        const offs = triangleOffsetsForCell(r,c,adjacencyKey);
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

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell = null) {
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine = false; cell.count = 0; cell.revealed = false; cell.flagged = false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  const forbidden = new Set();
  if (safeCell) {
    const [sr, sc] = safeCell;
    if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) {
      const offs = triangleOffsetsForCell(sr, sc, adjacencyKey).concat([[0,0]]);
      for (const [dr,dc] of offs) {
        const rr = sr + dr, cc = sc + dc;
        if (!inBounds(rows,cols,rr,cc)) continue;
        forbidden.add(idx(rows,cols,rr,cc));
      }
    } else {
      const offs = getOffsetsFor(tilingKey, adjacencyKey).concat([[0,0]]);
      for (const [dr,dc] of offs) {
        const rr = sr + dr, cc = sc + dc;
        if (!inBounds(rows,cols,rr,cc)) continue;
        forbidden.add(idx(rows,cols,rr,cc));
      }
    }
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
function revealCell(grid, r, c, tilingKey, adjacencyKey) {
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded: false };
  const iStart = idx(rows,cols,r,c);
  const startCell = cells[iStart];
  if (!startCell || startCell.revealed || startCell.flagged) return { changed: [], exploded: false };
  if (startCell.mine) { startCell.revealed = true; return { changed: [[r,c]], exploded: true }; }

  const changed = [];
  const stack = [[r,c]];

  while (stack.length){
    const [rr,cc] = stack.pop();
    const i = idx(rows,cols,rr,cc);
    const cell = cells[i];
    if (!cell || cell.revealed || cell.flagged) continue;
    cell.revealed = true; changed.push([rr,cc]);

    let offs;
    if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) {
      offs = triangleOffsetsForCell(rr, cc, adjacencyKey);
    } else {
      offs = getOffsetsFor(tilingKey, adjacencyKey);
    }

    if (cell.count === 0) {
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

function toggleFlag(grid, r, c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return null;
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed) return null;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}

function countFlaggedNeighbors(grid, r, c, tilingKey, adjacencyKey){
  let offs;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) offs = triangleOffsetsForCell(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  let cnt = 0;
  for (const [dr,dc] of offs){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) cnt++;
  }
  return cnt;
}

function revealUnflaggedNeighbors(grid, r, c, tilingKey, adjacencyKey){
  let offs;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) offs = triangleOffsetsForCell(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  const toReveal = [];
  for (const [dr,dc] of offs){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    const cell = grid.cells[idx(grid.rows, grid.cols, rr, cc)];
    if (!cell.flagged && !cell.revealed) toReveal.push([rr, cc]);
  }
  return toReveal;
}

function checkWin(grid){
  return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed));
}

// --- SVG helpers ---
function makeSvgElement(tag, attrs={}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}
function pointsToStr(points) { return points.map(p => `${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx, cy, size) {
  const s = size/2;
  return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]];
}
function computeTrianglePolygonFromCentroid(cx, cy, s, upward=true) {
  const h = Math.sqrt(3)/2 * s;
  const apexY = (upward ? cy - (2/3) * h : cy + (2/3) * h);
  const baseY  = (upward ? cy + (1/3) * h : cy - (1/3) * h);
  const half = s/2;
  return [[cx, apexY],[cx-half, baseY],[cx+half, baseY]];
}
// Flat-top hex polygon (angles start at 0)
function computeHexPolygon(cx, cy, radius, gapPx=1.0) {
  const visualR = Math.max(1, radius - gapPx);
  const pts = [];
  for (let k=0;k<6;k++){
    const angle = k*Math.PI/3; // flat-top
    pts.push([cx + visualR*Math.cos(angle), cy + visualR*Math.sin(angle)]);
  }
  return pts;
}

function hexCenter(rows, cols, radius) {
  const R = radius;
  const hexWidth = 2 * R;
  const hexHeight = Math.sqrt(3) * R;
  const xStep = 1.5 * R;
  const yStep = hexHeight;
  const centers = [];
  const PAD = 8;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const x = c * xStep + R + PAD;
      const y = r * yStep + ((c & 1) ? (hexHeight / 2) : 0) + R + PAD;
      centers.push({r,c,x,y});
    }
  }
  const w = (cols - 1) * xStep + hexWidth + PAD*2;
  const h = (rows - 1) * yStep + hexHeight + PAD*2;
  return {centers, w, h};
}

function squareCenter(rows, cols, size) {
  const PAD = 8;
  const centers = [];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const x = c * size + size/2 + PAD;
    const y = r * size + size/2 + PAD;
    centers.push({r,c,x,y});
  }
  return {centers, w: cols * size + 16, h: rows * size + 16};
}

// ---- Triangle vertex-lattice helpers (new) ----
function buildTriangleVertexLattice(rows, cols, s, PAD = 8) {
  const h = Math.sqrt(3) / 2 * s;
  const vx = s / 2;
  const vy = h;
  const vertexRows = rows + 1;
  const vertexCols = cols * 2 + 1;
  const vertices = [];
  for (let vr = 0; vr < vertexRows; vr++) {
    const y = PAD + vr * vy;
    const rowOffset = (vr % 2) ? vx : 0;
    for (let vc = 0; vc < vertexCols; vc++) {
      const x = PAD + rowOffset + vc * vx;
      vertices.push({ x, y, vr, vc });
    }
  }
  const vIndex = (vr, vc) => vr * vertexCols + vc;
  const triIndex = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const vr = r;
      const vc = c * 2;
      const upward = ((r + c) % 2) === 0;
      let verts;
      if (upward) {
        verts = [vIndex(vr, vc + 1), vIndex(vr + 1, vc), vIndex(vr + 1, vc + 2)];
      } else {
        verts = [vIndex(vr + 1, vc + 1), vIndex(vr, vc), vIndex(vr, vc + 2)];
      }
      triIndex.push({ r, c, upward, verts });
    }
  }
  const lastV = vertices[vertices.length - 1];
  const w = lastV ? lastV.x + (s/2) + PAD : (cols * s + PAD*2);
  const hTotal = (vertexRows - 1) * vy + PAD * 2 + h;
  return { vertices, triIndex, w, h: hTotal };
}

function shrinkTriangleVertices(vertsPts, shrinkPx = 0) {
  if (!shrinkPx) return vertsPts.map(v => [v.x, v.y]);
  const cx = (vertsPts[0].x + vertsPts[1].x + vertsPts[2].x) / 3;
  const cy = (vertsPts[0].y + vertsPts[1].y + vertsPts[2].y) / 3;
  return vertsPts.map(v => {
    const vx = cx - v.x;
    const vy = cy - v.y;
    const dist = Math.sqrt(vx*vx + vy*vy) || 1;
    const t = Math.min(1, shrinkPx / dist);
    return [v.x + vx * t, v.y + vy * t];
  });
}

// --- Rendering / UI ---
function renderTiledBoard() {
  const appRoot = document.getElementById('appRoot');
  if (!appRoot || !gameGrid) return;
  appRoot.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const requestedCols = Math.max(1, cols);
  const rawBase = Math.floor(720 / Math.max(8, requestedCols));
  const baseSize = Math.max(14, Math.min(48, rawBase));
  const gapScale = Number((document.getElementById('xGapSlider')||{value:1}).value || 1);
  const gapPx = Math.max(0, 1 * gapScale);

  const tileType = currentTiling || 'square';

  if (tileType === 'triangle') {
    const PAD = 8;
    const lattice = buildTriangleVertexLattice(rows, cols, baseSize, PAD);
    const { vertices, triIndex, w: svgW, h: svgH } = lattice;
    const svg = makeSvgElement('svg', { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}` });
    svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

    // shrink setting: wire to triShrinkSlider if present, or default proportional to baseSize
    const triShrinkVal = Number((document.getElementById('triShrinkSlider')||{value:Math.round(baseSize*0.06)}).value || Math.round(baseSize*0.06));
    const shrinkPx = Math.max(0, triShrinkVal);

    for (const ti of triIndex) {
      const r = ti.r, c = ti.c;
      const vertsPts = ti.verts.map(i => vertices[i]);
      const pts = shrinkTriangleVertices(vertsPts, shrinkPx);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'#0ea5b3', 'stroke-width':1, 'stroke-linejoin':'round', fill:'#022' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','#032');
      if (cell.flagged) poly.setAttribute('fill','#041');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
      poly.classList.add('tile');

      const lx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const ly = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 + 4;
      const label = makeSvgElement('text', { x: lx, y: ly, 'text-anchor': 'middle', 'font-size': Math.max(10, baseSize/3), 'pointer-events': 'none' });

      if (cell.revealed) {
        if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill', '#fff'); }
        else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
        else { label.textContent = ''; label.setAttribute('fill', '#9be7ff'); }
      } else if (cell.flagged) {
        label.textContent = '🚩'; label.setAttribute('fill', '#ffb86b');
      } else { label.textContent = ''; label.setAttribute('fill', '#9be7ff'); }

      // events mapped to grid coordinates
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
        if (checkWin(gameGrid)){ running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
        renderTiledBoard();
      });

      svg.appendChild(poly);
      svg.appendChild(label);
    }
    appRoot.appendChild(svg);
    return;
  }

  // hex or square
  let centersInfo;
  if (tileType === 'hex') centersInfo = hexCenter(rows, cols, baseSize / 2);
  else centersInfo = squareCenter(rows, cols, baseSize);

  const svg = makeSvgElement('svg', { width: centersInfo.w, height: centersInfo.h, viewBox: `0 0 ${centersInfo.w} ${centersInfo.h}` });
  svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

  for (const cellInfo of centersInfo.centers) {
    const r = cellInfo.r, c = cellInfo.c;
    const cx = cellInfo.x, cy = cellInfo.y;
    let pts;
    if (tileType === 'hex') pts = computeHexPolygon(cx, cy, baseSize/2, gapPx);
    else pts = computeSquarePolygon(cx, cy, baseSize);

    const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'#0ea5b3', 'stroke-width':1, 'stroke-linejoin':'round', fill:'#022' });
    const cell = gameGrid.cells[idx(rows,cols,r,c)];
    if (cell.revealed) poly.setAttribute('fill','#032');
    if (cell.flagged) poly.setAttribute('fill','#041');
    if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
    poly.classList.add('tile');

    const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': Math.max(12, baseSize/3), 'pointer-events': 'none' });
    if (cell.revealed) {
      if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill', '#fff'); }
      else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
      else label.textContent = '';
    } else if (cell.flagged) {
      label.textContent = '🚩'; label.setAttribute('fill', '#ffb86b');
    } else label.textContent = '';

    // events
    poly.addEventListener('click', ()=> {
      if (!running) return;
      if (cell.revealed && cell.count > 0) {
        const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
        if (flagged === cell.count) {
          const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
          let exploded = false;
          for (const [ar,ac] of toReveal) {
            const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency);
            if (res.exploded) exploded = true;
          }
          if (exploded) {
            running = false;
            gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
            const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'BOOM — a mine was revealed during chord';
          } else {
            if (checkWin(gameGrid)) { running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
            else { const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'Playing...'; }
          }
          renderTiledBoard();
          return;
        }
        return;
      }

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
      if (checkWin(gameGrid)){ running = false; const ms = document.getElementById('msStatus'); if (ms) ms.textContent = 'You win!'; }
      renderTiledBoard();
    });

    svg.appendChild(poly);
    svg.appendChild(label);
  }

  appRoot.appendChild(svg);
}

// --- Controls / wiring ---
function startNewGame() {
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:9}).value || 9));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:9}).value || 9));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows, cols, mines);
  running = true;
  firstClick = true;
  const statusEl = document.getElementById('msStatus');
  if (statusEl) statusEl.textContent = 'Ready — first click is safe';

  currentTiling = (document.getElementById('tilingSelect') || {}).value || Object.keys(TILINGS)[0];
  currentAdjacency = (document.getElementById('adjacencySelect') || {}).value || Object.keys(TILINGS[currentTiling].adjacencies)[0];

  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);

  if (currentTiling === 'square') renderTiledBoard(); else renderTiledBoard();

  try { window.gameGrid = gameGrid; window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; window.TILINGS = TILINGS; } catch(e){}
}

function populateTilingControls() {
  const sel = document.getElementById('tilingSelect');
  const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel) return;

  sel.innerHTML = '';
  for (const key of Object.keys(TILINGS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = TILINGS[key].label;
    sel.appendChild(opt);
  }

  function populateAdj(tilingKey) {
    adjSel.innerHTML = '';
    const adj = (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies) || {};
    for (const aKey of Object.keys(adj)) {
      const o = document.createElement('option');
      o.value = aKey; o.textContent = adj[aKey].label;
      adjSel.appendChild(o);
    }
    if (adjSel.options.length) adjSel.selectedIndex = 0;
  }

  const initial = sel.value || Object.keys(TILINGS)[0];
  populateAdj(initial);
  currentTiling = initial;
  currentAdjacency = adjSel.value || (adjSel.options[0] && adjSel.options[0].value);

  // remove previous to avoid duplicate handlers
  sel.__robust_change_handler && sel.removeEventListener('change', sel.__robust_change_handler);
  adjSel.__robust_change_handler && adjSel.removeEventListener('change', adjSel.__robust_change_handler);

  const tilingHandler = function(e) {
    const newTiling = (document.getElementById('tilingSelect')||{}).value || (e && e.target && e.target.value);
    populateAdj(newTiling);
    currentTiling = newTiling;
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || currentAdjacency;
    const statusEl = document.getElementById('msStatus');
    if (statusEl) {
      const label = (TILINGS[currentTiling] && TILINGS[currentTiling].label) || currentTiling;
      const adjLabel = (TILINGS[currentTiling] && TILINGS[currentTiling].adjacencies && TILINGS[currentTiling].adjacencies[currentAdjacency] && TILINGS[currentTiling].adjacencies[currentAdjacency].label) || currentAdjacency;
      statusEl.textContent = `Tiling: ${label} (Adjacency: ${adjLabel})`;
    }
    if (gameGrid && typeof computeCountsWithAdjacency === 'function') {
      try {
        computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
        renderTiledBoard();
      } catch (err) {
        console.error('Error on tiling change recompute:', err);
        startNewGame();
      }
    } else startNewGame();
    try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  };
  sel.__robust_change_handler = tilingHandler;
  sel.addEventListener('change', tilingHandler);

  const adjacencyHandler = function(e) {
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || (e && e.target && e.target.value);
    try { window.currentAdjacency = currentAdjacency; } catch(e){}
    if (gameGrid) {
      try { computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); } catch(err){ console.error(err); }
    }
  };
  adjSel.__robust_change_handler = adjacencyHandler;
  adjSel.addEventListener('change', adjacencyHandler);
}

function applyAdjacencyAction() {
  const sel = document.getElementById('tilingSelect');
  const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel) return;
  currentTiling = sel.value;
  currentAdjacency = adjSel.value;
  try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  if (gameGrid) {
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    renderTiledBoard();
    const ms = document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  } else {
    const ms = document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  }
}

function newGameAction() { startNewGame(); }

// --- Init and UI tuning sliders wiring ---
function initOnceDomReady() {
  populateTilingControls();

  const applyBtn = document.getElementById('applyAdjacency');
  const newBtn = document.getElementById('newGame');
  if (applyBtn) { applyBtn.removeEventListener('click', applyAdjacencyAction); applyBtn.addEventListener('click', applyAdjacencyAction); }
  if (newBtn) { newBtn.removeEventListener('click', newGameAction); newBtn.addEventListener('click', newGameAction); }

  // wire optional sliders if present
  const xSlider = document.getElementById('xGapSlider');
  const ySlider = document.getElementById('yGapSlider');
  const triSlider = document.getElementById('triShrinkSlider');
  if (xSlider) {
    xSlider.addEventListener('input', (e)=> {
      const v = e.target.value; const el = document.getElementById('xGapValue'); if (el) el.textContent = v;
      renderTiledBoard();
    });
  }
  if (ySlider) {
    ySlider.addEventListener('input', (e)=> {
      const v = e.target.value; const el = document.getElementById('yGapValue'); if (el) el.textContent = v;
      renderTiledBoard();
    });
  }
  if (triSlider) {
    triSlider.addEventListener('input', (e)=> {
      const v = e.target.value; const el = document.getElementById('triShrinkValue'); if (el) el.textContent = v;
      renderTiledBoard();
    });
  }

  const ms = document.getElementById('msStatus');
  if (ms) ms.textContent = 'Ready — select tiling and click New Game';

  startNewGame();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOnceDomReady);
else setTimeout(initOnceDomReady, 0);
