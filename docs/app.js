// docs/app.js — Minesweeper with Tiling + Adjacency (tiling => adjacency presets)
// Tiling = type of tile/tiling topology; Adjacency = neighbor rule applied on that topology.

const TILINGS = {
  // Square tiling: standard rectangular grid of square tiles
  "square": {
    label: "Square grid",
    // adjacency presets available for square tiling
    adjacencies: {
      "square-8": { label: "Square 8 (standard)", offsets: [
        [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]
      ]},
      "von-neumann": { label: "Von Neumann (4)", offsets: [
        [-1,0],[1,0],[0,-1],[0,1]
      ]},
      "knight": { label: "Knight moves", offsets: [
        [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]
      ]},
      "square-radius2": { label: "Square radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  // Triangle tiling: triangular grid (we represent triangle coordinates as (r,c) with alternating orientation)
  // Offsets below are given as row/col deltas assuming row-major indexed triangles where neighbors depend on orientation.
  "triangle": {
    label: "Triangular grid",
    adjacencies: {
      "tri-3": { label: "Triangle 3 (shared edges)", offsets: [
        // for triangles we will treat adjacency offsets symmetrically so flood/count works on cell coords;
        // these offsets are approximations for a staggered triangle tiling
        [-1,0],[0,-1],[0,1]
      ]},
      "tri-6": { label: "Triangle 6 (edges+vertices)", offsets: [
        [-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0]
      ]},
      "tri-12": { label: "Triangle radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  // Hex tiling: approximated using axial offsets mapped to row/col indices (we use even-r offset approximation)
  "hex": {
    label: "Hexagonal grid",
    adjacencies: {
      "hex-6": { label: "Hex 6 (standard)", offsets: [
        // even-r horizontal layout neighbor offsets (approx)
        [-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]
      ]},
      "hex-radius2": { label: "Hex radius 2", offsets: (function(){
        // generate radius-2 axial neighbors (approx as rectangular offsets)
        const o=[];
        for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]);
        return o;
      })() }
    }
  }
};

// UI element refs (IDs must match docs/index.html)
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
  console.error('Missing expected DOM controls; check docs/index.html IDs.');
}

// Populate tiling and adjacency controls
function populateTilingControls() {
  tilingSelect.innerHTML = '';
  for (const key of Object.keys(TILINGS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = TILINGS[key].label;
    tilingSelect.appendChild(opt);
  }
}
function populateAdjacencyForTiling(tilingKey) {
  adjacencySelect.innerHTML = '';
  const adj = TILINGS[tilingKey].adjacencies;
  for (const key of Object.keys(adj)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = adj[key].label;
    adjacencySelect.appendChild(opt);
  }
}

// initial population
populateTilingControls();
tilingSelect.value = Object.keys(TILINGS)[0];
populateAdjacencyForTiling(tilingSelect.value);
adjacencySelect.value = Object.keys(TILINGS[tilingSelect.value].adjacencies)[0];

let currentTiling = tilingSelect.value;
let currentAdjacency = adjacencySelect.value;

// keep adjacency updated when tiling changes
tilingSelect.addEventListener('change', () => {
  currentTiling = tilingSelect.value;
  populateAdjacencyForTiling(currentTiling);
  // pick the first adjacency option for the new tiling
  adjacencySelect.value = Object.keys(TILINGS[currentTiling].adjacencies)[0];
  currentAdjacency = adjacencySelect.value;
  msStatus.textContent = `Tiling set to ${TILINGS[currentTiling].label}; choose adjacency`;
});

// when adjacency chosen
adjacencySelect.addEventListener('change', () => {
  currentAdjacency = adjacencySelect.value;
});

// Accurate neighbor offsets getter — returns an array of [dr,dc] for the current tiling+adjacency
function getOffsetsForCurrent() {
  const adjObj = TILINGS[currentTiling].adjacencies[currentAdjacency];
  return adjObj && adjObj.offsets ? adjObj.offsets : [];
}

// Grid functions (we still store grid as row/col array; the offsets are applied onto that grid)
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithCurrentAdjacency(grid){
  const offsets = getOffsetsForCurrent();
  const { rows, cols, cells } = grid;
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

function placeMines(grid, mineCount, safeCell = null){
  const { rows, cols, cells } = grid;
  // reset
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
    const offsets = getOffsetsForCurrent();
    // include the cell itself plus adjacency-protected neighbors
    [[0,0]].concat(offsets).forEach(([dr,dc]) => {
      const rr = sr + dr, cc = sc + dc;
      if (!inBounds(rows,cols,rr,cc)) return;
      forbidden.add(idx(rows,cols,rr,cc));
    });
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
  computeCountsWithCurrentAdjacency(grid);
}

function revealCell(grid, r, c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded: false };
  const iStart = idx(rows,cols,r,c);
  const startCell = cells[iStart];
  if (!startCell || startCell.revealed || startCell.flagged) return { changed: [], exploded: false };
  if (startCell.mine) { startCell.revealed = true; return { changed: [[r,c]], exploded: true }; }

  const changed = [];
  const stack = [[r,c]];
  const offsets = getOffsetsForCurrent();

  while (stack.length){
    const [rr,cc] = stack.pop();
    const i = idx(rows,cols,rr,cc);
    const cell = cells[i];
    if (!cell || cell.revealed || cell.flagged) continue;
    cell.revealed = true; changed.push([rr,cc]);
    if (cell.count === 0){
      for (const [dr,dc] of offsets){
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

function countFlaggedNeighbors(grid, r, c){
  const offsets = getOffsetsForCurrent();
  let cnt = 0;
  for (const [dr,dc] of offsets){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) cnt++;
  }
  return cnt;
}

function revealUnflaggedNeighbors(grid, r, c){
  const offsets = getOffsetsForCurrent();
  const toReveal = [];
  for (const [dr,dc] of offsets){
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

// UI state and rendering
let gameGrid = null;
let running = false;
let firstClick = true;

function renderBoard(){
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
        } else {
          td.textContent = cell.count > 0 ? String(cell.count) : '';
          td.style.color = cell.count === 1 ? '#9be7ff' : '#ffd27a';
        }
      } else if (cell.flagged) {
        td.classList.add('flagged');
        td.textContent = '🚩';
      } else {
        td.textContent = '';
      }

      // left-click behavior (including chord when clicking revealed number)
      td.addEventListener('click', (e)=> {
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        const cellNow = gameGrid.cells[idx(gameGrid.rows, gameGrid.cols, rr, cc)];

        if (cellNow.revealed && cellNow.count > 0) {
          const flagged = countFlaggedNeighbors(gameGrid, rr, cc);
          if (flagged === cellNow.count) {
            const toReveal = revealUnflaggedNeighbors(gameGrid, rr, cc);
            let exploded = false;
            for (const [ar, ac] of toReveal) {
              const res = revealCell(gameGrid, ar, ac);
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
            renderBoard();
            return;
          }
          return;
        }

        if (firstClick){
          placeMines(gameGrid, Number(msMines.value), [rr,cc]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, rr, cc);
        if (res.exploded){
          running = false;
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          msStatus.textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
          else msStatus.textContent = 'Playing...';
        }
        renderBoard();
      });

      // right-click flag
      td.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        toggleFlag(gameGrid, rr, cc);
        if (checkWin(gameGrid)){ running = false; msStatus.textContent = 'You win!'; }
        else msStatus.textContent = 'Playing...';
        renderBoard();
      });

      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  appRoot.appendChild(tbl);
}

function startNewGame(auto = false){
  const rows = Math.max(3, Number(msRows.value || 9));
  const cols = Math.max(3, Number(msCols.value || 9));
  let mines = Math.max(1, Number(msMines.value || 10));
  mines = Math.min(mines, rows*cols - 1);
  gameGrid = createGrid(rows, cols, mines);
  running = true;
  firstClick = true;
  msStatus.textContent = 'Ready — first click is safe';
  renderBoard();
}

// Wiring: tiling/adjacency apply and new game
applyAdjacencyBtn.addEventListener('click', ()=> {
  currentTiling = tilingSelect.value;
  currentAdjacency = adjacencySelect.value;
  if (gameGrid) {
    // recompute counts for current mines using the new adjacency
    computeCountsWithCurrentAdjacency(gameGrid);
    renderBoard();
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  } else {
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  }
});

tilingSelect.addEventListener('change', ()=> {
  // update adjacency options when tiling changes
  populateAdjacencyForTiling(tilingSelect.value);
  adjacencySelect.value = Object.keys(TILINGS[tilingSelect.value].adjacencies)[0];
  currentTiling = tilingSelect.value;
  currentAdjacency = adjacencySelect.value;
  msStatus.textContent = `Tiling: ${TILINGS[currentTiling].label} (Adjacency set to ${TILINGS[currentTiling].adjacencies[currentAdjacency].label})`;
});

newGameBtn.addEventListener('click', ()=> startNewGame());

// helper to expose adjacencies for dynamic UI population
function populateAdjacencyForTiling(tilingKey) {
  adjacencySelect.innerHTML = '';
  const adj = TILINGS[tilingKey].adjacencies;
  for (const key of Object.keys(adj)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = adj[key].label;
    adjacencySelect.appendChild(opt);
  }
}

// initialize adjacency population properly for first load
populateAdjacencyForTiling(tilingSelect.value);
currentTiling = tilingSelect.value;
currentAdjacency = adjacencySelect.value || adjacencySelect.options[0].value;

// Start with a fresh game
startNewGame();
