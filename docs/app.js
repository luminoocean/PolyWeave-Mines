// docs/app.js — simple 2D Minesweeper UI for Pages (no bundler)
const SHAPES = {
  "square-8": { label: "Square 8 (standard)", offsets: [
    [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]
  ]},
  "von-neumann": { label: "Von Neumann (4)", offsets: [
    [-1,0],[1,0],[0,-1],[0,1]
  ]},
  "plus-extended": { label: "Plus (radius 2)", offsets: [
    [-2,0],[-1,0],[1,0],[2,0],[0,-2],[0,-1],[0,1],[0,2]
  ]},
  "hex-like": { label: "Hex (approx)", offsets: [
    [-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0]
  ]},
  "knight": { label: "Knight moves", offsets: [
    [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]
  ]},
  "custom": { label: "Custom (edit)", offsets: [] }
};

(async function(){
  // tiny DOM references
  const root = document.createElement('div');
  root.style.maxWidth = '760px';
  root.style.margin = '12px auto';
  document.body.insertBefore(root, document.querySelector('main') || document.body.firstChild);

  const controls = document.createElement('div');
  controls.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label>Rows <input id="msRows" type="number" value="9" style="width:60px"></label>
      <label>Cols <input id="msCols" type="number" value="9" style="width:60px"></label>
      <label>Mines <input id="msMines" type="number" value="10" style="width:60px"></label>
      <button id="newGame">New Game</button>
      <div id="msStatus" style="margin-left:12px;color:#9bb4c9"></div>
    </div>
  `;
  root.appendChild(controls);

  const boardWrap = document.createElement('div');
  root.appendChild(boardWrap);

  // import grid module via relative path using ES module loader trick: inline functions to avoid module paths in Pages
  // copy the minimal grid functions inline here to avoid require/browser issues
  // (we'll inline a slim subset adapted from src/grid)
  function idx(rows, cols, r, c){ return r*cols + c; }
  function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

  function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({mine:false,revealed:false,flagged:false,count:0})) }; }
  function placeMines(grid, mineCount){
    const { rows, cols, cells } = grid;
    const total = rows*cols;
    const perm = Array.from({length: total}, (_,i)=>i);
    for (let i = total-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let k=0;k<mineCount;k++) cells[perm[k]].mine = true;
    // counts
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count = -1; continue; }
      let cnt=0;
      for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++){
        if (dr===0 && dc===0) continue;
        const rr=r+dr, cc=c+dc;
        if (!inBounds(rows,cols,rr,cc)) continue;
        if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
      }
      cells[i].count = cnt;
    }
  }
  function revealCell(grid, r, c){
    const {rows, cols, cells} = grid;
    const i = idx(rows,cols,r,c);
    const cell = cells[i];
    if (!cell || cell.revealed || cell.flagged) return {changed:[], exploded:false};
    if (cell.mine){ cell.revealed = true; return {changed:[[r,c]], exploded:true}; }
    const changed=[];
    const stack=[[r,c]];
    while(stack.length){
      const [rr,cc]=stack.pop();
      const ii = idx(rows,cols,rr,cc);
      const ce = cells[ii];
      if (ce.revealed || ce.flagged) continue;
      ce.revealed = true; changed.push([rr,cc]);
      if (ce.count === 0){
        for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++){
          if (dr===0 && dc===0) continue;
          const nr=rr+dr, nc=cc+dc;
          if (!inBounds(rows,cols,nr,nc)) continue;
          if (!cells[idx(rows,cols,nr,nc)].revealed) stack.push([nr,nc]);
        }
      }
    }
    return {changed, exploded:false};
  }
  function toggleFlag(grid,r,c){ const i = idx(grid.rows,grid.cols,r,c); const cell = grid.cells[i]; if (!cell || cell.revealed) return; cell.flagged = !cell.flagged; }

  // game state
  let gameGrid = null;
  let running = false;

  function renderBoard() {
    boardWrap.innerHTML = '';
    if (!gameGrid) return;
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    const { rows, cols, cells } = gameGrid;
    for (let r=0;r<rows;r++){
      const tr = document.createElement('tr');
      for (let c=0;c<cols;c++){
        const td = document.createElement('td');
        td.style.width = td.style.height = '28px';
        td.style.textAlign = 'center';
        td.style.padding = '0';
        td.style.border = '1px solid rgba(155,231,255,0.06)';
        td.style.background = '#04182b';
        td.style.cursor = 'pointer';
        const cell = cells[idx(rows,cols,r,c)];
        if (cell.revealed){
          td.style.background = '#022';
          td.style.color = '#9be7ff';
          td.textContent = cell.mine ? '💣' : (cell.count > 0 ? cell.count : '');
        } else if (cell.flagged){
          td.textContent = '🚩';
        } else {
          td.textContent = '';
        }
        td.addEventListener('click', (e)=> {
          if (!running) return;
          const res = revealCell(gameGrid, r, c);
          if (res.exploded) {
            running = false;
            document.getElementById('msStatus').textContent = 'BOOM — you hit a mine';
            // reveal all mines
            gameGrid.cells.forEach((cl, i)=> { if (cl.mine) cl.revealed = true; });
          } else {
            if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
            else document.getElementById('msStatus').textContent = 'Playing...';
          }
          renderBoard();
        });
        td.addEventListener('contextmenu', (e)=> {
          e.preventDefault();
          if (!running) return;
          toggleFlag(gameGrid, r, c);
          if (checkWin(gameGrid)) { running = false; document.getElementById('msStatus').textContent = 'You win!'; }
          renderBoard();
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    boardWrap.appendChild(table);
  }

  function checkWin(grid){
    return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed));
  }

  document.getElementById('newGame').addEventListener('click', ()=> {
    const rows = Math.max(3, Number(document.getElementById('msRows').value || 9));
    const cols = Math.max(3, Number(document.getElementById('msCols').value || 9));
    let mines = Number(document.getElementById('msMines').value || 10);
    mines = Math.min(mines, rows*cols-1);
    gameGrid = createGrid(rows, cols);
    placeMines(gameGrid, mines);
    running = true;
    document.getElementById('msStatus').textContent = 'Playing...';
    renderBoard();
  });

  // start a default game
  document.getElementById('newGame').click();

})();
