// docs/app.js — Full Minesweeper app with Tiling + Adjacency and SVG tile rendering
// Replaces previous file. Uses exact lattice center math and a visual gapPx to ensure tiles do not touch.
// Expects controls in docs/index.html with IDs:
// msRows, msCols, msMines, tilingSelect, adjacencySelect, applyAdjacency, newGame, msStatus, appRoot

// --- TILINGS + adjacency presets (tilings that repeat infinitely) ---
const TILINGS = {
  "square": {
    label: "Square",
    adjacencies: {
      "square-8":  { label: "Square 8 (all 8)", offsets: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] },
      "von-neumann":{ label: "Von Neumann (4)", offsets: [[-1,0],[1,0],[0,-1],[0,1]] },
      "knight":     { label: "Knight moves", offsets: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] },
      "square-r2":  { label: "Square radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  "triangle": {
    label: "Triangle",
    adjacencies: {
      "tri-edge": { label: "Triangle edge neighbors (3)", offsets: null },        // per-cell
      "tri-edge+v": { label: "Triangle edges+vertices (6)", offsets: null },    // per-cell
      "tri-r2": { label: "Triangle radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  "hex": {
    label: "Hexagon",
    adjacencies: {
      "hex-6": { label: "Hex 6 (standard)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] },
      "hex-r2": { label: "Hex radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  }
};

// --- DOM refs ---
const appRoot = document.getElementById('appRoot');
const msRows = document.getElementById('msRows');
const msCols = document.getElementById('msCols');
const msMines = document.getElementById('msMines');
const newGameBtn = document.getElementById('newGame');
const msStatus = document.getElementById('msStatus');

const tilingSelect = document.getElementById('tilingSelect');
const adjacencySelect = document.getElementById('adjacencySelect');
const applyAdjacencyBtn = document.getElementById('applyAdjacency');

if (!appRoot || !msRows || !msCols || !msMines || !newGameBtn || !tilingSelect || !adjacencySelect || !applyAdjacencyBtn || !msStatus) {
  console.error('Missing expected DOM controls. Ensure docs/index.html contains the control elements with correct IDs.');
}

// --- Visual constants ---
const NUMBER_COLORS = {
  1: '#3ec7ff', // blue
  2: '#ff6b6b', // red
  3: '#ffd27a', // yellow/orange
  4: '#a88cff',
  5: '#ff9fb3',
  6: '#7ce7ff',
  7: '#d3d3d3',
  8: '#b0c4de'
};

// --- Helpers ---
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

// triangle orientation: returns true if upward for given center (r,c)
function triangleOrientation(r, c) {
  return ((r + c) % 2) === 0;
}

// returns per-cell offsets for triangle adjacency based on orientation
function triangleOffsetsForCell(r, c, adjKey) {
  const up = triangleOrientation(r, c);
  if (adjKey === 'tri-edge') {
    // edge-sharing adjacency: three neighbors
    return up ? [[0,-1],[1,0],[0,1]]   // left, down-right, right
              : [[0,-1],[-1,0],[0,1]]; // left, up-left, right
  }
  if (adjKey === 'tri-edge+v') {
    // edges + vertex-sharing neighbors (6)
    return up ? [[0,-1],[-1,0],[1,0],[0,1],[-1,1],[1,-1]]
              : [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,1]];
  }
  // fallback symmetric neighborhood
  const arr = [];
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (!(dr===0&&dc===0)) arr.push([dr,dc]);
  return arr;
}

// return offsets[] for tiling+adjacency; triangle may return null (means per-cell)
function getOffsetsFor(tilingKey, adjacencyKey) {
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) return null;
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

// --- Grid API ---
function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) {
    // per-cell offsets for triangles
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

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell = null){
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

function revealCell(grid, r, c, tilingKey, adjacencyKey){
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

    // determine neighbors per tiling/adjacency
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

// --- SVG renderer helpers ---
function makeSvgElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}
function pointsToStr(points) {
  return points.map(p => `${p[0]},${p[1]}`).join(' ');
}
function computeSquarePolygon(cx, cy, size) {
  const s = size/2;
  return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]];
}

// compute triangle vertices from centroid (cx,cy)
// s is the desired side length to draw (visual side length, i.e., after subtracting gap)
function computeTrianglePolygonFromCentroid(cx, cy, s, upward = true) {
  const h = Math.sqrt(3) / 2 * s;
  // centroid is h/3 from base toward apex
  const apexY = (upward ? cy - (2/3) * h : cy + (2/3) * h);
  const baseY  = (upward ? cy + (1/3) * h : cy - (1/3) * h);
  const half = s / 2;
  return [
    [cx, apexY],
    [cx - half, baseY],
    [cx + half, baseY]
  ];
}

// precise hex polygon (pointy-top) with a visual gapPx
function computeHexPolygon(cx, cy, radius, gapPx = 1.0) {
  const visualR = Math.max(1, radius - gapPx);
  const pts = [];
  for (let k=0;k<6;k++){
    const angle = Math.PI/6 + k*Math.PI/3;
    pts.push([cx + visualR*Math.cos(angle), cy + visualR*Math.sin(angle)]);
  }
  return pts;
}

// --- Center calculations using exact lattice geometry (no arbitrary GAP multipliers) ---

// hex grid centers using pointy-top odd-q offset layout with exact steps
// This places hexes in a honeycomb where edges are parallel across rows (pointy-top layout).
function hexCenter(rows, cols, radius) {
  const R = radius;
  const hexWidth = 2 * R;
  const hexHeight = Math.sqrt(3) * R;
  // For pointy-top hexes the horizontal step is 3/2 * R and vertical is sqrt(3) * R
  const xStep = 1.5 * R;
  const yStep = hexHeight;
  const centers = [];
  const PAD = 8;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      // odd-q style offset (stagger rows by column parity)
      const x = c * xStep + R + PAD;
      const y = r * yStep + ((c & 1) ? (hexHeight / 2) : 0) + R + PAD;
      centers.push({r,c,x,y});
    }
  }
  const w = (cols - 1) * xStep + hexWidth + PAD*2;
  const h = (rows - 1) * yStep + hexHeight + PAD*2;
  return {centers, w, h};
}

// square centers
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

// triangle centers arranged for exact equilateral tiling (alternating up/down)
// Use centroid lattice: xStep = s/2, yStep = 2/3 * h so centroids of up/down triangles line up without apex/base overlap.
function triangleCenter(rows, cols, s) {
  const h = Math.sqrt(3)/2 * s;      // full triangle height for nominal side s
  const xStep = s / 2;               // horizontal step between centroids
  const yStep = (2/3) * h;           // vertical centroid step between adjacent up/down triangles
  const centers = [];
  const PAD = 8;
  // y0 positions first centroid so centroid is at distance h/3 from top edge of its bounding triangle
  const y0 = PAD + h / 3;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * xStep + s / 2 + PAD;
      const y = r * yStep + y0;
      centers.push({ r, c, x, y });
    }
  }

  const w = (cols - 1) * xStep + s + PAD * 2;
  const H = (rows - 1) * yStep + h + PAD * 2;
  return { centers, w, h: H };
}

// --- UI and state ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;

function renderTiledBoard() {
  appRoot.innerHTML = '';
  if (!gameGrid) return;
  const rows = gameGrid.rows, cols = gameGrid.cols;

  // choose base tile size and spacing based on cols (no arbitrary global shrink)
  const requestedCols = Math.max(1, cols);
  const rawBase = Math.floor(720 / Math.max(8, requestedCols));
  const baseSize = Math.max(14, Math.min(48, rawBase));
  const gapPx = 1.0; // visual separation in pixels; increase for larger gaps on high-DPI

  let centersInfo;
  const tileType = currentTiling || 'square';

  if (tileType === 'hex') centersInfo = hexCenter(rows, cols, baseSize / 2);
  else if (tileType === 'triangle') centersInfo = triangleCenter(rows, cols, baseSize);
  else centersInfo = squareCenter(rows, cols, baseSize);

  const svg = makeSvgElement('svg', {width: centersInfo.w, height: centersInfo.h, viewBox: `0 0 ${centersInfo.w} ${centersInfo.h}`});
  svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

  for (const cellInfo of centersInfo.centers) {
    const r = cellInfo.r, c = cellInfo.c;
    const cx = cellInfo.x, cy = cellInfo.y;
    let pts;
    if (tileType === 'hex') pts = computeHexPolygon(cx, cy, baseSize/2, gapPx);
    else if (tileType === 'triangle') {
      const nominalS = baseSize;
      const visualS = Math.max(2, nominalS - 2*gapPx);
      pts = computeTrianglePolygonFromCentroid(cx, cy, visualS, triangleOrientation(r,c));
    } else pts = computeSquarePolygon(cx, cy, baseSize);

    const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke: '#0ea5b3', 'stroke-width': 1, 'stroke-linejoin': 'round', fill: '#022' });
    const cell = gameGrid.cells[idx(rows,cols,r,c)];
    if (cell.revealed) poly.setAttribute('fill','#032');
    if (cell.flagged) poly.setAttribute('fill','#041');
    if (cell.mine && cell.revealed) poly.setAttribute('fill','#550');
    poly.classList.add('tile');

    const label = makeSvgElement('text', {
      x: cx,
      y: cy + 4,
      'text-anchor': 'middle',
      'font-size': Math.max(12, baseSize/3),
      'pointer-events': 'none'
    });

    // choose label text and color
    if (cell.revealed) {
      if (cell.mine) {
        label.textContent = '💣';
        label.setAttribute('fill', '#fff');
      } else if (cell.count > 0) {
        label.textContent = String(cell.count);
        label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff');
      } else {
        label.textContent = '';
        label.setAttribute('fill', '#9be7ff');
      }
    } else if (cell.flagged) {
      label.textContent = '🚩';
      label.setAttribute('fill', '#ffb86b');
    } else {
      label.textContent = '';
      label.setAttribute('fill', '#9be7ff');
    }

    poly.addEventListener('click', ()=> {
      if (!running) return;
      const rr = r, cc = c;
      const cellNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, rr, cc)];

      if (cellNow.revealed && cellNow.count > 0) {
        const flagged = countFlaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
        if (flagged === cellNow.count) {
          const toReveal = revealUnflaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
          let exploded = false;
          for (const [ar, ac] of toReveal) {
            const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency);
            if (res.exploded) exploded = true;
          }
          if (exploded) {
            running = false;
            gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
            msStatus.textContent = 'BOOM — a mine was revealed during chord';
          } else {
            if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
            else msStatus.textContent = 'Playing...';
          }
          renderTiledBoard();
          return;
        }
        return;
      }

      if (firstClick){
        placeMines(gameGrid, Number(msMines.value), currentTiling, currentAdjacency, [rr,cc]);
        firstClick = false;
      }
      const res = revealCell(gameGrid, rr, cc, currentTiling, currentAdjacency);
      if (res.exploded){
        running = false;
        gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
        msStatus.textContent = 'BOOM — you hit a mine';
      } else {
        if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
        else msStatus.textContent = 'Playing...';
      }
      renderTiledBoard();
    });

    poly.addEventListener('contextmenu', (e)=> {
      e.preventDefault();
      if (!running) return;
      toggleFlag(gameGrid, r, c);
      if (checkWin(gameGrid)){ running = false; msStatus.textContent = 'You win!'; }
      else msStatus.textContent = 'Playing...';
      renderTiledBoard();
    });

    svg.appendChild(poly);
    svg.appendChild(label);
  }

  appRoot.appendChild(svg);
}

// fallback square table renderer
function renderTableBoard() {
  appRoot.innerHTML = '';
  if (!gameGrid) return;
  const tbl = document.createElement('table');
  tbl.className = 'mboard';
  const { rows, cols, cells } = gameGrid;
  for (let r=0;r<rows;r++){
    const tr = document.createElement('tr');
    for (let c=0;c<cols;c++){
      const td = document.createElement('td');
      const cell = cells[idx(rows,cols,r,c)];
      td.dataset.r = r; td.dataset.c = c;
      td.className = '';
      if (cell.revealed){
        td.classList.add('revealed');
        if (cell.mine){
          td.classList.add('mine');
          td.textContent = '💣';
          td.style.color = '#fff';
        } else {
          if (cell.count > 0) {
            td.textContent = String(cell.count);
            td.style.color = NUMBER_COLORS[cell.count] || '#9be7ff';
          } else {
            td.textContent = '';
            td.style.color = '';
          }
        }
      } else if (cell.flagged) {
        td.classList.add('flagged');
        td.textContent = '🚩';
        td.style.color = '#ffb86b';
      } else {
        td.textContent = '';
        td.style.color = '';
      }

      td.addEventListener('click', ()=> {
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        const cellNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, rr, cc)];

        if (cellNow.revealed && cellNow.count > 0) {
          const flagged = countFlaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
          if (flagged === cellNow.count) {
            const toReveal = revealUnflaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
            let exploded = false;
            for (const [ar, ac] of toReveal) {
              const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency);
              if (res.exploded) exploded = true;
            }
            if (exploded) {
              running = false;
              gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
              msStatus.textContent = 'BOOM — a mine was revealed during chord';
            } else {
              if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
              else msStatus.textContent = 'Playing...';
            }
            renderTableBoard();
            return;
          }
          return;
        }

        if (firstClick){
          placeMines(gameGrid, Number(msMines.value), currentTiling, currentAdjacency, [rr,cc]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, rr, cc, currentTiling, currentAdjacency);
        if (res.exploded){
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          msStatus.textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
          else msStatus.textContent = 'Playing...';
        }
        renderTableBoard();
      });

      td.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        toggleFlag(gameGrid, rr, cc);
        if (checkWin(gameGrid)){ running = false; msStatus.textContent = 'You win!'; }
        else msStatus.textContent = 'Playing...';
        renderTableBoard();
      });

      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  appRoot.appendChild(tbl);
}

// --- Game control and wiring ---
function startNewGame(auto = false){
  const rows = Math.max(3, Number(msRows.value || 9));
  const cols = Math.max(3, Number(msCols.value || 9));
  let mines = Math.max(1, Number(msMines.value || 10));
  mines = Math.min(mines, rows*cols - 1);
  gameGrid = createGrid(rows, cols, mines);
  running = true;
  firstClick = true;
  msStatus.textContent = 'Ready — first click is safe';
  if (!currentTiling) {
    currentTiling = tilingSelect.value || Object.keys(TILINGS)[0];
    currentAdjacency = adjacencySelect.value || Object.keys(TILINGS[currentTiling].adjacencies)[0];
  }
  if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
}

// populate tiling/adacency selectors
function populateTilingControls() {
  tilingSelect.innerHTML = '';
  for (const key of Object.keys(TILINGS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = TILINGS[key].label;
    tilingSelect.appendChild(opt);
  }

  function populateAdj(tilingKey){
    adjacencySelect.innerHTML = '';
    const adj = TILINGS[tilingKey].adjacencies || {};
    for (const aKey of Object.keys(adj)) {
      const o = document.createElement('option');
      o.value = aKey; o.textContent = adj[aKey].label;
      adjacencySelect.appendChild(o);
    }
    if (adjacencySelect.options.length) adjacencySelect.selectedIndex = 0;
  }

  const initial = tilingSelect.value || Object.keys(TILINGS)[0];
  populateAdj(initial);
  currentTiling = initial;
  currentAdjacency = adjacencySelect.value || adjacencySelect.options[0].value;

  tilingSelect.addEventListener('change', (e) => {
    populateAdj(e.target.value);
    currentTiling = e.target.value;
    currentAdjacency = adjacencySelect.value;
    msStatus.textContent = `Tiling: ${TILINGS[currentTiling].label} (Adjacency: ${TILINGS[currentTiling].adjacencies[currentAdjacency].label})`;
    if (gameGrid) {
      if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
    }
  });

  adjacencySelect.addEventListener('change', ()=> {
    currentAdjacency = adjacencySelect.value;
  });
}

applyAdjacencyBtn.addEventListener('click', ()=> {
  currentTiling = tilingSelect.value;
  currentAdjacency = adjacencySelect.value;
  if (gameGrid) {
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  } else {
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  }
});

newGameBtn.addEventListener('click', ()=> startNewGame());

// Robust initialization: ensure DOM is ready, controls exist, then populate and start
function initOnceDomReady() {
  // re-check DOM refs in case script ran too early
  if (!tilingSelect || !adjacencySelect || !msRows || !msCols || !msMines || !newGameBtn || !applyAdjacencyBtn || !appRoot || !msStatus) {
    // try to rebind the DOM elements by id in case module scope had stale refs
    // (this helps in cases where script executed before DOM but variables captured earlier)
    const _appRoot = document.getElementById('appRoot');
    const _msRows = document.getElementById('msRows');
    const _msCols = document.getElementById('msCols');
    const _msMines = document.getElementById('msMines');
    const _newGameBtn = document.getElementById('newGame');
    const _msStatus = document.getElementById('msStatus');
    const _tilingSelect = document.getElementById('tilingSelect');
    const _adjacencySelect = document.getElementById('adjacencySelect');
    const _applyAdjacencyBtn = document.getElementById('applyAdjacency');
    if (_appRoot) window.appRoot = _appRoot;
    if (_msRows) window.msRows = _msRows;
    if (_msCols) window.msCols = _msCols;
    if (_msMines) window.msMines = _msMines;
    if (_newGameBtn) window.newGameBtn = _newGameBtn;
    if (_msStatus) window.msStatus = _msStatus;
    if (_tilingSelect) window.tilingSelect = _tilingSelect;
    if (_adjacencySelect) window.adjacencySelect = _adjacencySelect;
    if (_applyAdjacencyBtn) window.applyAdjacencyBtn = _applyAdjacencyBtn;
  }

  // If still missing, abort and log
  if (!document.getElementById('tilingSelect') || !document.getElementById('adjacencySelect')) {
    console.error('Initialization failed: tiling/adacency controls not found in DOM.');
    return;
  }

  // Now populate controls and start
  populateTilingControls();
  currentTiling = tilingSelect.value || Object.keys(TILINGS)[0];
  currentAdjacency = adjacencySelect.value || Object.keys(TILINGS[currentTiling].adjacencies)[0];
  startNewGame();
}

// Always attach DOMContentLoaded and also run immediately if ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnceDomReady);
} else {
  initOnceDomReady();
}
