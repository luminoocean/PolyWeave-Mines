// docs/app.js — Minesweeper with Tiling + Adjacency presets
// Self-contained; expects controls in docs/index.html with IDs:
// msRows, msCols, msMines, tilingSelect, adjacencySelect, applyAdjacency, newGame, msStatus, appRoot

// --- TILINGS + adjacency presets (tilings that repeat infinitely) ---
const TILINGS = {
  // Square tiling
  "square": {
    label: "Square",
    adjacencies: {
      "square-8":  { label: "Square 8 (all 8)", offsets: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] },
      "von-neumann":{ label: "Von Neumann (4)", offsets: [[-1,0],[1,0],[0,-1],[0,1]] },
      "knight":     { label: "Knight moves", offsets: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] },
      "square-r2":  { label: "Square radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  // Triangle tiling (regular triangular lattice approximated on row/col)
  "triangle": {
    label: "Triangle",
    adjacencies: {
      "tri-edge": { label: "Triangle edge neighbors (3)", offsets: [[-1,0],[0,-1],[0,1]] },
      "tri-edge+v": { label: "Triangle edges+vertices (6)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0]] },
      "tri-r2": { label: "Triangle radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  },

  // Hex tiling (approximated with even-r offsets)
  "hex": {
    label: "Hexagon",
    adjacencies: {
      "hex-6": { label: "Hex 6 (standard)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] },
      "hex-r2": { label: "Hex radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
    }
  }
};

// --- DOM refs (must match docs/index.html) ---
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

// --- Helpers ---
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

// return offsets[] for current tiling+adjacency
function getOffsetsFor(tilingKey, adjacencyKey) {
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

// --- Grid API ---
function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey){
  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
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

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  // reset cell states (but keep revealed/flagged cleared)
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
    const offsets = getOffsetsFor(tilingKey, adjacencyKey);
    // protect the clicked cell and its adjacency neighbors
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
  const offsets = getOffsetsFor(tilingKey, adjacencyKey);

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

function countFlaggedNeighbors(grid, r, c, tilingKey, adjacencyKey){
  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
  let cnt = 0;
  for (const [dr,dc] of offsets){
    const rr = r + dr, cc = c + dc;
    if (!inBounds(grid.rows, grid.cols, rr, cc)) continue;
    if (grid.cells[idx(grid.rows, grid.cols, rr, cc)].flagged) cnt++;
  }
  return cnt;
}

function revealUnflaggedNeighbors(grid, r, c, tilingKey, adjacencyKey){
  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
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

// --- UI and state ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = tilingSelect.value || Object.keys(TILINGS)[0];
let currentAdjacency = adjacencySelect.value || Object.keys(TILINGS[currentTiling].adjacencies)[0];

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

      // left-click handler: reveal OR chord when clicking a revealed number
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
            renderBoard();
            return;
          }
          return;
        }

        // normal reveal
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

// --- UI population and wiring ---
function populateTilingControls() {
  // populate tiling select
  tilingSelect.innerHTML = '';
  for (const key of Object.keys(TILINGS)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = TILINGS[key].label;
    tilingSelect.appendChild(opt);
  }
  // populate adjacency for current tiling
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

  // update adjacency when tiling changes
  tilingSelect.addEventListener('change', (e) => {
    populateAdj(e.target.value);
    currentTiling = e.target.value;
    currentAdjacency = adjacencySelect.value;
    msStatus.textContent = `Tiling: ${TILINGS[currentTiling].label} (Adjacency: ${TILINGS[currentTiling].adjacencies[currentAdjacency].label})`;
  });

  // update adjacency selection
  adjacencySelect.addEventListener('change', ()=> {
    currentAdjacency = adjacencySelect.value;
  });
}

// apply adjacency button: recompute counts for current mines (preserve mine layout)
applyAdjacencyBtn.addEventListener('click', ()=> {
  currentTiling = tilingSelect.value;
  currentAdjacency = adjacencySelect.value;
  if (gameGrid) {
    computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
    renderBoard();
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  } else {
    msStatus.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`;
  }
});

newGameBtn.addEventListener('click', ()=> startNewGame());

// ensure control population after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', populateTilingControls);
} else {
  populateTilingControls();
}

// initialize adjacency variables and start
currentTiling = tilingSelect.value || Object.keys(TILINGS)[0];
currentAdjacency = adjacencySelect.value || Object.keys(TILINGS[currentTiling].adjacencies)[0];
startNewGame();
