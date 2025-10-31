// docs/app.js — playable 2D Minesweeper with shape options
// Simple, self-contained; uses SHAPES and inlined grid logic.

const SHAPES = {
  "square-8": { label: "Square 8 (standard)", offsets: [ [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1] ] },
  "von-neumann": { label: "Von Neumann 4", offsets: [ [-1,0],[1,0],[0,-1],[0,1] ] },
  "plus-extended": { label: "Plus radius 2", offsets: [ [-2,0],[-1,0],[1,0],[2,0],[0,-2],[0,-1],[0,1],[0,2] ] },
  "hex-like": { label: "Hex like", offsets: [ [-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0] ] },
  "knight": { label: "Knight moves", offsets: [ [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1] ] },
  "custom": { label: "Custom (edit)", offsets: [] }
};

const appRoot = document.getElementById('appRoot');
const msRows = document.getElementById('msRows');
const msCols = document.getElementById('msCols');
const msMines = document.getElementById('msMines');
const newGameBtn = document.getElementById('newGame');
const msStatus = document.getElementById('msStatus');
const shapeSelect = document.getElementById('shapeSelect');
const applyShapeBtn = document.getElementById('applyShape');

// populate shapes
Object.keys(SHAPES).forEach(k => {
  const o = document.createElement('option');
  o.value = k; o.textContent = SHAPES[k].label;
  shapeSelect.appendChild(o);
});
let currentShape = 'square-8';
shapeSelect.value = currentShape;

// grid helpers
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function placeMines(grid, mineCount, safeCell = null){
  const { rows, cols, cells } = grid;
  // clear first
  cells.forEach(cell => { cell.mine = false; cell.count = 0; cell.revealed = false; cell.flagged = false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  // if safeCell provided, remove its index and neighbors from selection so first click is safe
  const forbidden = new Set();
  if (safeCell) {
    const [sr, sc] = safeCell;
    const offsets = SHAPES[currentShape].offsets.concat([[0,0]]);
    for (const [dr,dc] of offsets) {
      const rr = sr + dr, cc = sc + dc;
      if (!inBounds(rows,cols,rr,cc)) continue;
      forbidden.add(idx(rows,cols,rr,cc));
    }
  }
  // shuffle with fisher-yates but skip forbidden indices by swapping them toward end
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // pick first mineCount non-forbidden entries
  let placed = 0, k = 0;
  while (placed < Math.min(mineCount, total - 1) && k < total) {
    const pos = perm[k++];
    if (forbidden.has(pos)) continue;
    cells[pos].mine = true;
    placed++;
  }
  grid.mines = placed;
  computeCountsWithShape(grid, currentShape);
}

function computeCountsWithShape(grid, shapeKey){
  const offsets = (SHAPES[shapeKey] && SHAPES[shapeKey].offsets) || SHAPES['square-8'].offsets;
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

function revealCell(grid, r, c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded: false };
  const iStart = idx(rows,cols,r,c);
  const startCell = cells[iStart];
  if (!startCell || startCell.revealed || startCell.flagged) return { changed: [], exploded: false };
  if (startCell.mine) { startCell.revealed = true; return { changed: [[r,c]], exploded: true }; }

  const changed = [];
  const stack = [[r,c]];
  const offsets = (SHAPES[currentShape] && SHAPES[currentShape].offsets) || SHAPES['square-8'].offsets;

  while (stack.length){
    const [rr,cc] = stack.pop();
    const i = idx(rows,cols,rr,cc);
    const cell = cells[i];
    if (!cell || cell.revealed || cell.flagged) continue;
    cell.revealed = true; changed.push([rr,cc]);
    if (cell.count === 0){
      // push neighbors using shape offsets
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

function checkWin(grid){
  return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed));
}

// UI rendering
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

      td.addEventListener('click', (e)=> {
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        if (firstClick){
          // place mines with safe first click
          placeMines(gameGrid, Number(msMines.value), [rr,cc]);
          firstClick = false;
        }
        const res = revealCell(gameGrid, rr, cc);
        if (res.exploded){
          running = false;
          // reveal all mines
          gameGrid.cells.forEach(cl => { if (cl.mine) cl.revealed = true; });
          msStatus.textContent = 'BOOM — you hit a mine';
        } else {
          if (checkWin(gameGrid)) { running = false; msStatus.textContent = 'You win!'; }
          else msStatus.textContent = 'Playing...';
        }
        renderBoard();
      });

      td.addEventListener('contextmenu', (e)=> {
        e.preventDefault();
        if (!running) return;
        const rr = Number(td.dataset.r), cc = Number(td.dataset.c);
        toggleFlag(gameGrid, rr, cc);
        if (checkWin(gameGrid)){ running = false; msStatus.textContent = 'You win!'; }
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
  if (auto) {
    // optional: auto-place mines (not doing that by default)
  }
}

// wiring
newGameBtn.addEventListener('click', ()=> startNewGame());
applyShapeBtn.addEventListener('click', ()=> {
  currentShape = shapeSelect.value;
  // recompute counts for current board without changing mine placement
  if (gameGrid) {
    computeCountsWithShape(gameGrid, currentShape);
    // if firstClick is true and no mines placed yet, nothing to recompute, safe
    renderBoard();
    msStatus.textContent = `Applied shape ${SHAPES[currentShape].label}`;
  }
});

// start
startNewGame();
