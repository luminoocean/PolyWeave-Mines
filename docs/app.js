// docs/app.js — Full Minesweeper app with robust DOM-binding (listeners always query by ID)
// Drop this file in place of previous app.js. Expects index.html to include elements with IDs:
// msRows, msCols, msMines, tilingSelect, adjacencySelect, applyAdjacency, newGame, msStatus, appRoot

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
const NUMBER_COLORS = {
  1: '#3ec7ff', 2: '#ff6b6b', 3: '#ffd27a', 4: '#a88cff', 5: '#ff9fb3',
  6: '#7ce7ff', 7: '#d3d3d3', 8: '#b0c4de'
};

// --- Module-scoped state (not assumed on window) ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;

// --- Small helpers ---
function idx(rows, cols, r, c) { return r * cols + c; }
function inBounds(rows, cols, r, c) { return r >= 0 && r < rows && c >= 0 && c < cols; }
function triangleOrientation(r, c) { return ((r + c) % 2) === 0; }

function triangleOffsetsForCell(r, c, adjKey) {
  const up = triangleOrientation(r, c);
  if (adjKey === 'tri-edge') return up ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  if (adjKey === 'tri-edge+v') {
    return up ? [[0,-1],[-1,0],[1,0],[0,1],[-1,1],[1,-1]] : [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,1]];
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
    for (let r=0;r<rows;r++) {
      for (let c=0;c<cols;c++) {
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
  for (let r=0;r<rows;r++) {
    for (let c=0;c<cols;c++) {
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }
      let cnt = 0;
      for (const [dr,dc] of offsets) {
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

// --- Reveal / Flag / Chord logic ---
function revealCell(grid, r, c, tilingKey, adjacencyKey) {
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded: false };
  const iStart = idx(rows,cols,r,c);
  const startCell = cells[iStart];
  if (!startCell || startCell.revealed || startCell.flagged) return { changed: [], exploded: false };
  if (startCell.mine) { startCell.revealed = true; return { changed: [[r,c]], exploded: true }; }

  const changed = [];
  const stack = [[r,c]];

  while (stack.length) {
    const [rr,cc] = stack.pop();
    const i = idx(rows,cols,rr,cc);
    const cell = cells[i];
    if (!cell || cell.revealed || cell.flagged) continue;
    cell.revealed = true; changed.push([rr,cc]);

    let offs;
    if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) offs = triangleOffsetsForCell(rr, cc, adjacencyKey);
    else offs = getOffsetsFor(tilingKey, adjacencyKey);

    if (cell.count === 0) {
      for (const [dr,dc] of offs) {
        const nr = rr + dr, nc = cc + dc;
        if (!inBounds(rows,cols,nr,nc)) continue;
        const ni = idx(rows,cols,nr,nc);
        if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]);
      }
    }
  }
  return { changed, exploded: false };
}

function toggleFlag(grid, r, c) {
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return null;
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed) return null;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}

function countFlaggedNeighbors(grid, r, c, tilingKey, adjacencyKey) {
  let offs;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) offs = triangleOffsetsForCell(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  let cnt = 0;
  for (const [dr,dc] of offs) {
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) cnt++;
  }
  return cnt;
}

function revealUnflaggedNeighbors(grid, r, c, tilingKey, adjacencyKey) {
  let offs;
  if (tilingKey === 'triangle' && (adjacencyKey === 'tri-edge' || adjacencyKey === 'tri-edge+v')) offs = triangleOffsetsForCell(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  const toReveal = [];
  for (const [dr,dc] of offs) {
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    const cell = grid.cells[idx(grid.rows, grid.cols, rr, cc)];
    if (!cell.flagged && !cell.revealed) toReveal.push([rr, cc]);
  }
  return toReveal;
}

function checkWin(grid) {
  return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed));
}

// --- SVG helpers and center math (triangle/hex exact lattices) ---
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
function computeHexPolygon(cx, cy, radius, gapPx=1.0) {
  const visualR = Math.max(1, radius - gapPx);
  const pts = [];
  for (let k=0;k<6;k++){
    const angle = Math.PI/3 + k*Math.PI/3;
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

function triangleCenter(rows, cols, s) {
  const h = Math.sqrt(3)/2 * s;
  const xGap = parseFloat(document.getElementById('xGapSlider')?.value || 1.0);
  const yGap = parseFloat(document.getElementById('yGapSlider')?.value || 1.0);
  const xStep = s / 2 * xGap;
  const yStep = (2/3) * h * yGap;
  const centers = [];
  const PAD = 8;
  const y0 = PAD + (2/3) * h;
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


// --- Renderers ---
function renderTiledBoard() {
  const appRootEl = document.getElementById('appRoot');
  if (!appRootEl || !gameGrid) return;
  appRootEl.innerHTML = '';
  const rows = gameGrid.rows, cols = gameGrid.cols;

  const requestedCols = Math.max(1, cols);
  const rawBase = Math.floor(720 / Math.max(8, requestedCols));
  const baseSize = Math.max(14, Math.min(48, rawBase));
  const gapPx = 1.0;

  const tileType = currentTiling || 'square';
  let centersInfo;
  if (tileType === 'hex') centersInfo = hexCenter(rows, cols, baseSize / 2);
  else if (tileType === 'triangle') centersInfo = triangleCenter(rows, cols, baseSize);
  else centersInfo = squareCenter(rows, cols, baseSize);

  const svg = makeSvgElement('svg', { width: centersInfo.w, height: centersInfo.h, viewBox: `0 0 ${centersInfo.w} ${centersInfo.h}` });
  svg.style.maxWidth = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';

  for (const ci of centersInfo.centers) {
    const r = ci.r, c = ci.c;
    const cx = ci.x, cy = ci.y;
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

    const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': Math.max(12, baseSize/3), 'pointer-events': 'none' });

    if (cell.revealed) {
      if (cell.mine) { label.textContent = '💣'; label.setAttribute('fill','#fff'); }
      else if (cell.count > 0) { label.textContent = String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count] || '#9be7ff'); }
      else { label.textContent = ''; label.setAttribute('fill', '#9be7ff'); }
    } else if (cell.flagged) {
      label.textContent = '🚩'; label.setAttribute('fill','#ffb86b');
    } else {
      label.textContent = ''; label.setAttribute('fill', '#9be7ff');
    }

    // event handlers capture module state and always call module functions (no reliance on external stale refs)
    poly.addEventListener('click', ()=> {
      if (!running) return;
      if (gameGrid.rows !== rows || gameGrid.cols !== cols) return; // safety
      const cellNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, r, c)];
      if (cellNow.revealed && cellNow.count > 0) {
        const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
        if (flagged === cellNow.count) {
          const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
          let exploded = false;
          for (const [ar,ac] of toReveal) {
            const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency);
            if (res.exploded) exploded = true;
          }
          if (exploded) {
            running = false;
            gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
            document.getElementById('msStatus').textContent = 'BOOM — a mine was revealed during chord';
          } else {
            if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
            else document.getElementById('msStatus').textContent = 'Playing...';
          }
          renderTiledBoard();
          return;
        }
        return;
      }

      if (firstClick) {
        const minesVal = Number((document.getElementById('msMines')||{}).value || 10);
        placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]);
        firstClick = false;
      }
      const res = revealCell(gameGrid, r, c, currentTiling, currentAdjacency);
      if (res.exploded) {
        running = false;
        gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
        document.getElementById('msStatus').textContent = 'BOOM — you hit a mine';
      } else {
        if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
        else document.getElementById('msStatus').textContent = 'Playing...';
      }
      renderTiledBoard();
    });

    poly.addEventListener('contextmenu', (e)=> {
      e.preventDefault();
      if (!running) return;
      toggleFlag(gameGrid, r, c);
      if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
      else document.getElementById('msStatus').textContent = 'Playing...';
      renderTiledBoard();
    });

    svg.appendChild(poly);
    svg.appendChild(label);
  }

  appRootEl.appendChild(svg);
}

function renderTableBoard() {
  const appRootEl = document.getElementById('appRoot');
  if (!appRootEl || !gameGrid) return;
  appRootEl.innerHTML = '';
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
          } else td.textContent = '';
        }
      } else if (cell.flagged) {
        td.classList.add('flagged');
        td.textContent = '🚩';
        td.style.color = '#ffb86b';
      } else td.textContent = '';

      td.addEventListener('click', ()=> {
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        const cellNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, rr, cc)];
        if (cellNow.revealed && cellNow.count > 0) {
          const flagged = countFlaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
          if (flagged === cellNow.count) {
            const toReveal = revealUnflaggedNeighbors(gameGrid, rr, cc, currentTiling, currentAdjacency);
            let exploded = false;
            for (const [ar,ac] of toReveal) {
              const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency);
              if (res.exploded) exploded = true;
            }
            if (exploded) {
              running = false;
              gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
              document.getElementById('msStatus').textContent = 'BOOM — a mine was revealed during chord';
            } else {
              if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
              else document.getElementById('msStatus').textContent = 'Playing...';
            }
            renderTableBoard();
            return;
          }
          return;
        }

        if (firstClick) {
          const minesVal = Number((document.getElementById('msMines')||{}).value || 10);
          placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [rr,cc]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, rr, cc, currentTiling, currentAdjacency);
        if (res.exploded) {
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          document.getElementById('msStatus').textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
          else document.getElementById('msStatus').textContent = 'Playing...';
        }
        renderTableBoard();
      });

      td.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        toggleFlag(gameGrid, rr, cc);
        if (checkWin(gameGrid)){ running = false; document.getElementById('msStatus').textContent = 'You win!'; }
        else document.getElementById('msStatus').textContent = 'Playing...';
        renderTableBoard();
      });

      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  appRootEl.appendChild(tbl);
}

// --- Controls wiring: robust handlers that always query DOM by ID (no stale refs) ---
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

  // read tiling/adjacency directly from DOM (guaranteed fresh)
  currentTiling = (document.getElementById('tilingSelect') || {}).value || Object.keys(TILINGS)[0];
  currentAdjacency = (document.getElementById('adjacencySelect') || {}).value || Object.keys(TILINGS[currentTiling].adjacencies)[0];

  // compute counts with chosen adjacency
  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);

  if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();

  // expose debug-friendly window refs (optional, small surface)
  try {
    window.gameGrid = gameGrid;
    window.currentTiling = currentTiling;
    window.currentAdjacency = currentAdjacency;
    window.TILINGS = TILINGS;
  } catch(e){}
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

  // Attach robust handlers: remove duplicates first to avoid multiple attachments if init runs twice
  sel.removeEventListener('__robust_change', sel.__robust_change_handler || (()=>{})); // noop removal safe
  adjSel.removeEventListener('__robust_change', adjSel.__robust_change_handler || (()=>{}));

  // change handler for tiling: always query DOM by ID and then apply logic
  const tilingHandler = function(e) {
    const newTiling = (document.getElementById('tilingSelect')||{}).value || e && e.target && e.target.value;
    populateAdj(newTiling);
    currentTiling = newTiling;
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || currentAdjacency;

    // update status
    const statusEl = document.getElementById('msStatus');
    if (statusEl) {
      const label = (TILINGS[currentTiling] && TILINGS[currentTiling].label) || currentTiling;
      const adjLabel = (TILINGS[currentTiling] && TILINGS[currentTiling].adjacencies && TILINGS[currentTiling].adjacencies[currentAdjacency] && TILINGS[currentTiling].adjacencies[currentAdjacency].label) || currentAdjacency;
      statusEl.textContent = `Tiling: ${label} (Adjacency: ${adjLabel})`;
    }

    // prefer recompute if a game exists otherwise start new
    if (gameGrid && typeof computeCountsWithAdjacency === 'function') {
      try {
        computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
        if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
      } catch (err) {
        console.error('Error on tiling change recompute:', err);
        startNewGame();
      }
    } else startNewGame();

    // mirror to window for console debugging
    try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  };

  tilingHandler.__robust_marker = true;
  sel.__robust_change_handler = tilingHandler;
  sel.addEventListener('change', tilingHandler);

  // adjacency change handler
  const adjacencyHandler = function(e) {
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || (e && e.target && e.target.value);
    try { window.currentAdjacency = currentAdjacency; } catch(e){}
    if (gameGrid) {
      try {
        computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
        if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
      } catch(err) {
        console.error('Error recomputing after adjacency change', err);
      }
    }
  };
  adjacencyHandler.__robust_marker = true;
  adjSel.__robust_change_handler = adjacencyHandler;
  adjSel.addEventListener('change', adjacencyHandler);
}

// apply adjacency button behavior (wired by DOM id)
function applyAdjacencyAction() {
  const sel = document.getElementById('tilingSelect');
  const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel) return;
  currentTiling = sel.value;
  currentAdjacency = adjSel.value;
  try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  if (gameGrid) {
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    if (currentTiling === 'square') renderTableBoard(); else renderTiledBoard();
    const ms = document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  } else {
    const ms = document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  }
}

// newGame action wrapper
function newGameAction() { startNewGame(); }

// --- Global one-time init that binds DOM hooks by ID and wires actions ---
function initOnceDomReady() {
  // wire controls by ID to avoid stale module-captured references
  const applyBtn = document.getElementById('applyAdjacency');
  const newBtn = document.getElementById('newGame');
  // populate selects and attach internal handlers
  populateTilingControls();

  // wire apply and new game with id-based listeners (remove previous to avoid duplicates)
  if (applyBtn) {
    applyBtn.removeEventListener('click', applyAdjacencyAction);
    applyBtn.addEventListener('click', applyAdjacencyAction);
  }
  if (newBtn) {
    newBtn.removeEventListener('click', newGameAction);
    newBtn.addEventListener('click', newGameAction);
  }

  // ensure msStatus exists
  const ms = document.getElementById('msStatus');
  if (ms) ms.textContent = 'Ready — select tiling and click New Game';

  // create initial game
  startNewGame();
}

// run once DOM is ready; use both DOMContentLoaded and an immediate attempt to handle odd load ordering
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnceDomReady);
} else {
  // immediate but defer to end-of-call-stack to let other scripts finish
  setTimeout(initOnceDomReady, 0);
}
