// app.js
// Full minimal Minesweeper with:
// - Autosave settings & game (localStorage)
// - Custom adjacency editor (15x15) saved to localStorage and added to dropdown
// - Copy / Paste import-export (base64-encoded JSON)
// - Mobile flag-mode toggle button
// - Pan & zoom preserved

const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let gameGrid = null;
let running = false;
let firstClick = true;
let currentAdjacency = 'all8';
let customAdj = {}; // name -> offsets array
const view = { scale: 0.6, tx: 0, ty: 0 };

const STORAGE_KEY = 'polyweave_state_v1';
const CUSTOM_KEY = 'polyweave_custom_adj_v1';

// utils
function idx(rows,cols,r,c){ return r*cols + c; }
function inBounds(rows,cols,r,c){ return r>=0 && r<rows && c>=0 && c<cols; }
function createGrid(rows,cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// adjacency registry (built-ins)
function squareOffsets(r,c,adj){
  if (adj === 'edges4') return [[-1,0],[1,0],[0,-1],[0,1]];
  if (adj === 'all8') return [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  // custom patterns: stored in customAdj as name -> offsets
  if (customAdj[adj]) return customAdj[adj];
  return [[-1,0],[1,0],[0,-1],[0,1]];
}

// geometry helpers
function squareCenter(rows,cols,side){
  const PAD = 12; const centers=[];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = PAD + c*side + side/2; const y = PAD + r*side + side/2; centers.push({r,c,x,y}); }
  return { centers, w: PAD*2 + cols*side, h: PAD*2 + rows*side };
}

// svg helpers
function makeSvg(tag, attrs={}){ const el=document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function polyPoints(pts){ return pts.map(p=>`${p[0]},${p[1]}`).join(' '); }

// render
function renderBoard(){
  const svg = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svg || !container || !gameGrid) return;
  svg.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const side = Math.max(14, Math.floor(900 / Math.max(12, cols)));
  const info = squareCenter(rows,cols,side);

  svg.setAttribute('viewBox', `0 0 ${info.w} ${info.h}`);
  svg.setAttribute('width', info.w);
  svg.setAttribute('height', info.h);

  for (const cell of info.centers){
    const r=cell.r, c=cell.c, cx=cell.x, cy=cell.y;
    const s = side/2;
    const pts = [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]];
    const poly = makeSvg('polygon',{ points: polyPoints(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)', style:'cursor:pointer' });
    const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
    if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
    if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
    if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

    const fontSize = Math.max(11, Math.floor(side * 0.45));
    const label = makeSvg('text',{ x:cx, y:cy + Math.floor(fontSize*0.35), 'text-anchor':'middle', 'font-size': fontSize, style:'pointer-events:none; user-select:none' });

    if (cellObj.revealed){
      if (cellObj.mine){ label.textContent='💣'; label.setAttribute('fill','#fff'); }
      else if (cellObj.count>0){ label.textContent=String(cellObj.count); label.setAttribute('fill', NUMBER_COLORS[cellObj.count]||'#9be7ff'); }
    } else if (cellObj.flagged){ label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); }

    attachHandlers(poly, r, c);
    svg.appendChild(poly);
    svg.appendChild(label);
  }

  container.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  container.style.transformOrigin = 'center center';
}

// game logic
function computeCounts(grid, adjacency){
  const { rows, cols, cells } = grid;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i=idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count = -1; continue; }
      const offsets = squareOffsets(r,c,adjacency);
      let cnt = 0;
      for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
  }
}

function placeMines(grid, mineCount, safe){
  const { rows, cols, cells } = grid;
  cells.forEach(cell=>{ cell.mine=false; cell.revealed=false; cell.flagged=false; cell.count=0; });
  const total = rows*cols;
  const perm = Array.from({length:total}, (_,i) => i);
  for (let i=total-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safe){
    const [sr,sc] = safe;
    forbidden.add(idx(rows,cols,sr,sc));
    for (const [dr,dc] of squareOffsets(sr,sc,currentAdjacency)){ const rr=sr+dr, cc=sc+dc; if (inBounds(rows,cols,rr,cc)) forbidden.add(idx(rows,cols,rr,cc)); }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){
    const pos = perm[k++];
    if (forbidden.has(pos)) continue;
    cells[pos].mine = true; placed++;
  }
  computeCounts(grid,currentAdjacency);
}

// reveal/flag/chord & helpers
function revealCell(grid,r,c){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed:[], exploded:false };
  const i=idx(rows,cols,r,c); const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed:[], exploded:false };
  if (cell.mine){ cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed = true; changed.push([rr,cc]);
    if (cl.count === 0){
      for (const [dr,dc] of squareOffsets(rr,cc,currentAdjacency)){
        const nr = rr+dr, nc = cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni = idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]);
      }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if (!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if (!cell || cell.revealed) return null; cell.flagged = !cell.flagged; return cell.flagged; }
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }
function countFlaggedNeighbors(grid,r,c){ let count=0; for (const [dr,dc] of squareOffsets(r,c,currentAdjacency)){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) count++; } return count; }

// handlers
function attachHandlers(el,r,c){
  el.addEventListener('click', (e)=>{
    e.stopPropagation();
    if (!running) return;

    // mobile flag-mode check
    const flagModeActive = document.body.classList.contains('flag-mode');
    if (flagModeActive){
      toggleFlag(gameGrid,r,c);
      if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; }
      saveAll();
      renderBoard();
      return;
    }

    // chord behavior
    const cellObjNow = gameGrid.cells[idx(gameGrid.rows,gameGrid.cols,r,c)];
    if (cellObjNow.revealed && cellObjNow.count > 0){
      const flagged = countFlaggedNeighbors(gameGrid,r,c);
      if (flagged === cellObjNow.count){
        let exploded=false;
        for (const [dr,dc] of squareOffsets(r,c,currentAdjacency)){
          const rr=r+dr, cc=c+dc; if (!inBounds(gameGrid.rows,gameGrid.cols,rr,cc)) continue;
          const neigh = gameGrid.cells[idx(gameGrid.rows,gameGrid.cols,rr,cc)];
          if (!neigh.flagged && !neigh.revealed){
            const res = revealCell(gameGrid,rr,cc); if (res.exploded) exploded=true;
          }
        }
        if (exploded){ running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; }
        else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } }
        saveAll(); renderBoard(); return;
      }
      return;
    }

    if (firstClick){
      const mines = Math.max(1, Number((document.getElementById('msMines')||{value:40}).value || 40));
      placeMines(gameGrid, mines, [r,c]);
      firstClick = false;
    }
    const res = revealCell(gameGrid,r,c);
    if (res.exploded){ running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); document.getElementById('msStatus').textContent='BOOM'; }
    else { if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } else document.getElementById('msStatus').textContent='Playing...'; }
    saveAll(); renderBoard();
  });

  el.addEventListener('contextmenu', (e)=>{ e.preventDefault(); e.stopPropagation(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; document.getElementById('msStatus').textContent='You win!'; } saveAll(); renderBoard(); });
}

// controls & UI wiring
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:12}).value || 12));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:16}).value || 16));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:40}).value || 40));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows,cols);
  running = true; firstClick = true;
  document.getElementById('msStatus').textContent = 'Ready — first click is safe';
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || 'all8';
  saveAll();
  renderBoard();
}

function wireControls(){
  document.getElementById('newGame').addEventListener('click', ()=>{ startNewGame(); });
  document.getElementById('msRows').addEventListener('change', ()=>{ persistSettings(); startNewGame(); });
  document.getElementById('msCols').addEventListener('change', ()=>{ persistSettings(); startNewGame(); });
  document.getElementById('msMines').addEventListener('change', ()=>{ persistSettings(); startNewGame(); });
  document.getElementById('adjacencySelect').addEventListener('change', (e)=>{ currentAdjacency = e.target.value; computeCounts(gameGrid,currentAdjacency); persistSettings(); renderBoard(); saveAll(); });
  document.getElementById('themeSelect').addEventListener('change', (e)=>{ document.body.setAttribute('data-theme', e.target.value || 'dark-ocean'); persistSettings(); saveAll(); renderBoard(); });

  // flag-mode button
  const flagBtn = document.getElementById('flagMode');
  if (flagBtn){
    flagBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); const on = document.body.classList.toggle('flag-mode'); flagBtn.setAttribute('aria-pressed', on); });
  }

  // copy / paste
  document.getElementById('copyGame').addEventListener('click', ()=>{ const s = exportStateString(); navigator.clipboard.writeText(s).then(()=>{ flashStatus('Copied'); }).catch(()=>{ flashStatus('Copy failed'); }); });
  document.getElementById('pasteGame').addEventListener('click', ()=>{ openPasteModal(); });

  // adjacency editor open
  document.getElementById('openAdjEditor').addEventListener('click', ()=>{ openAdjModal(); });

  // modal close handlers
  document.getElementById('closeAdj').addEventListener('click', ()=>{ closeAdjModal(); });
  document.getElementById('closePaste').addEventListener('click', ()=>{ closePasteModal(); });

  // import button
  document.getElementById('importBtn').addEventListener('click', ()=>{ const v = document.getElementById('pasteInput').value.trim(); try{ importStateString(v); closePasteModal(); flashStatus('Imported'); } catch(e){ flashStatus('Invalid code'); } });

  // preview start
  document.getElementById('previewStart').addEventListener('click', ()=>{ startPreview(); });

  // editor controls wired in initEditor()
}

// autosave / persistence
function persistSettings(){
  const settings = {
    rows: Number((document.getElementById('msRows')||{value:12}).value),
    cols: Number((document.getElementById('msCols')||{value:16}).value),
    mines: Number((document.getElementById('msMines')||{value:40}).value),
    adjacency: (document.getElementById('adjacencySelect')||{}).value || 'all8',
    theme: (document.getElementById('themeSelect')||{}).value || 'dark-ocean'
  };
  localStorage.setItem(STORAGE_KEY + '_settings', JSON.stringify(settings));
}

function saveAll(){
  try{
    const settings = {
      rows: Number((document.getElementById('msRows')||{value:12}).value),
      cols: Number((document.getElementById('msCols')||{value:16}).value),
      mines: Number((document.getElementById('msMines')||{value:40}).value),
      adjacency: (document.getElementById('adjacencySelect')||{}).value || 'all8',
      theme: (document.getElementById('themeSelect')||{}).value || 'dark-ocean'
    };
    const state = {
      settings,
      game: gameGrid ? {
        mines: gameGrid.cells.map((c,i)=> c.mine ? i : -1).filter(i=> i>=0),
        revealed: gameGrid.cells.map((c,i)=> c.revealed ? i : -1).filter(i=> i>=0),
        flagged: gameGrid.cells.map((c,i)=> c.flagged ? i : -1).filter(i=> i>=0),
        firstClick, running
      } : null,
      customAdj,
      view
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customAdj));
  }catch(e){ console.error('save failed', e); }
}

function loadAll(){
  try{
    const savedCustom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}');
    if (savedCustom && typeof savedCustom === 'object'){ customAdj = savedCustom; populateCustomAdjToDropdown(); }
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const settingsRaw = JSON.parse(localStorage.getItem(STORAGE_KEY + '_settings') || 'null');
    if (settingsRaw){
      document.getElementById('msRows').value = settingsRaw.rows;
      document.getElementById('msCols').value = settingsRaw.cols;
      document.getElementById('msMines').value = settingsRaw.mines;
      document.getElementById('adjacencySelect').value = settingsRaw.adjacency || 'all8';
      document.getElementById('themeSelect').value = settingsRaw.theme || 'dark-ocean';
      document.body.setAttribute('data-theme', settingsRaw.theme || 'dark-ocean');
    }
    if (!raw) return;
    if (raw.customAdj) { customAdj = raw.customAdj; populateCustomAdjToDropdown(); }
    if (raw.settings){
      document.getElementById('msRows').value = raw.settings.rows;
      document.getElementById('msCols').value = raw.settings.cols;
      document.getElementById('msMines').value = raw.settings.mines;
      document.getElementById('adjacencySelect').value = raw.settings.adjacency || 'all8';
      document.getElementById('themeSelect').value = raw.settings.theme || 'dark-ocean';
      document.body.setAttribute('data-theme', raw.settings.theme || 'dark-ocean');
    }
    if (raw.game){
      const s = raw.game;
      const r = raw.settings ? raw.settings.rows : Number(document.getElementById('msRows').value);
      const c = raw.settings ? raw.settings.cols : Number(document.getElementById('msCols').value);
      gameGrid = createGrid(r,c);
      (s.mines||[]).forEach(i => { if (i >=0 && i < gameGrid.cells.length) gameGrid.cells[i].mine = true; });
      (s.revealed||[]).forEach(i => { if (i >=0 && i < gameGrid.cells.length) gameGrid.cells[i].revealed = true; });
      (s.flagged||[]).forEach(i => { if (i >=0 && i < gameGrid.cells.length) gameGrid.cells[i].flagged = true; });
      firstClick = !!s.firstClick;
      running = !!s.running;
      computeCounts(gameGrid, document.getElementById('adjacencySelect').value);
    }
    if (raw.view) { Object.assign(view, raw.view); }
  }catch(e){ console.warn('load failed', e); }
}

// copy / paste export-import
function exportStateString(){
  // compact state: settings + game arrays + customAdj
  const settings = {
    rows: Number(document.getElementById('msRows').value),
    cols: Number(document.getElementById('msCols').value),
    mines: Number(document.getElementById('msMines').value),
    adjacency: document.getElementById('adjacencySelect').value,
    theme: document.getElementById('themeSelect').value
  };
  const game = gameGrid ? {
    mines: gameGrid.cells.map((c,i)=> c.mine ? i : -1).filter(i=>i>=0),
    revealed: gameGrid.cells.map((c,i)=> c.revealed ? i : -1).filter(i=>i>=0),
    flagged: gameGrid.cells.map((c,i)=> c.flagged ? i : -1).filter(i=>i>=0),
    firstClick, running
  } : null;
  const payload = { v:1, s:settings, g:game, custom:customAdj };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function importStateString(str){
  const json = JSON.parse(decodeURIComponent(escape(atob(str))));
  if (!json || !json.s) throw new Error('invalid');
  // apply settings
  document.getElementById('msRows').value = json.s.rows;
  document.getElementById('msCols').value = json.s.cols;
  document.getElementById('msMines').value = json.s.mines;
  document.getElementById('adjacencySelect').value = json.s.adjacency || 'all8';
  document.getElementById('themeSelect').value = json.s.theme || 'dark-ocean';
  document.body.setAttribute('data-theme', json.s.theme || 'dark-ocean');
  // custom patterns
  if (json.custom){ customAdj = json.custom; populateCustomAdjToDropdown(); }
  // game
  if (json.g){
    const r = json.s.rows, c = json.s.cols;
    gameGrid = createGrid(r,c);
    (json.g.mines||[]).forEach(i=>{ if (i>=0 && i<gameGrid.cells.length) gameGrid.cells[i].mine=true; });
    (json.g.revealed||[]).forEach(i=>{ if (i>=0 && i<gameGrid.cells.length) gameGrid.cells[i].revealed=true; });
    (json.g.flagged||[]).forEach(i=>{ if (i>=0 && i<gameGrid.cells.length) gameGrid.cells[i].flagged=true; });
    firstClick = !!json.g.firstClick;
    running = !!json.g.running;
    computeCounts(gameGrid, document.getElementById('adjacencySelect').value);
  }
  saveAll(); renderBoard();
}

// helper: small status flash
function flashStatus(txt){
  const el = document.getElementById('msStatus');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = txt;
  setTimeout(()=> el.textContent = prev, 1200);
}

// adjacency editor modal
function openAdjModal(){
  document.getElementById('adjModal').setAttribute('aria-hidden','false');
  document.querySelectorAll('#adjModal .tab').forEach(t=> t.classList.remove('active'));
  document.querySelector('#adjModal .tab[data-tab="editor"]').classList.add('active');
  document.querySelectorAll('#adjModal .tabpane').forEach(p=> p.classList.remove('active'));
  document.getElementById('editorTab').classList.add('active');
  initEditorGrid();
}
function closeAdjModal(){ document.getElementById('adjModal').setAttribute('aria-hidden','true'); }
function openPasteModal(){ document.getElementById('pasteModal').setAttribute('aria-hidden','false'); }
function closePasteModal(){ document.getElementById('pasteModal').setAttribute('aria-hidden','true'); }

// init editor grid (15x15)
function initEditorGrid(){
  const gridEl = document.getElementById('editorGrid');
  gridEl.innerHTML = '';
  const size = 15;
  for (let r=0;r<size;r++){
    for (let c=0;c<size;c++){
      const cell = document.createElement('div');
      cell.className = 'editor-cell';
      cell.dataset.r = r; cell.dataset.c = c;
      if (r === Math.floor(size/2) && c === Math.floor(size/2)){ cell.classList.add('editor-centre'); cell.innerHTML = '💣'; cell.style.cursor='default'; cell.dataset.center = '1'; }
      else cell.addEventListener('click', editorToggleCell);
      gridEl.appendChild(cell);
    }
  }
  // wire editor controls
  document.getElementById('clearAdj').onclick = clearEditor;
  document.getElementById('saveAdj').onclick = saveEditorPattern;
}

// editor helpers
function editorToggleCell(e){
  const el = e.currentTarget;
  if (el.dataset.center) return;
  el.classList.toggle('on');
}
function clearEditor(){
  document.querySelectorAll('#editorGrid .editor-cell.on').forEach(x=> x.classList.remove('on'));
}
function saveEditorPattern(){
  const size = 15; const cx = Math.floor(size/2), cy = Math.floor(size/2);
  const nodes = [];
  document.querySelectorAll('#editorGrid .editor-cell.on').forEach(el=>{
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    nodes.push([r - cx, c - cy]);
  });
  const nameInput = document.getElementById('adjName');
  let name = (nameInput && nameInput.value && nameInput.value.trim()) || `custom_${Date.now()}`;
  // ensure unique
  let i = 1; while (customAdj[name]){ name = `${name}_${i++}`; }
  customAdj[name] = nodes;
  populateCustomAdjToDropdown();
  saveAll();
  flashStatus('Saved');
  nameInput.value = '';
}

// populate user patterns into adjacency dropdown
function populateCustomAdjToDropdown(){
  const sel = document.getElementById('adjacencySelect');
  // remove previous custom options
  Array.from(sel.querySelectorAll('option[data-custom="1"]')).forEach(o=> o.remove());
  // append
  for (const key of Object.keys(customAdj || {})){
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = key;
    opt.dataset.custom = '1';
    sel.appendChild(opt);
  }
}

// preview small minesweeper in modal
let previewGame = null;
function startPreview(){
  const pr = Number(document.getElementById('previewRows').value || 9);
  const pc = Number(document.getElementById('previewCols').value || 9);
  const pm = Number(document.getElementById('previewMines').value || 10);
  previewGame = createGrid(pr,pc);
  placeMines(previewGame, pm, [Math.floor(pr/2), Math.floor(pc/2)]);
  computeCounts(previewGame, document.getElementById('adjacencySelect').value);
  renderPreview(previewGame, 'previewArea');
}
function renderPreview(grid, hostId){
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = '';
  const rows = grid.rows, cols = grid.cols;
  const tbl = document.createElement('div');
  tbl.style.display='grid';
  tbl.style.gridTemplateColumns = `repeat(${cols},22px)`;
  tbl.style.gap='4px';
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      const el = document.createElement('div');
      el.style.width='22px'; el.style.height='22px'; el.style.background='rgba(255,255,255,0.02)'; el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center';
      if (r === Math.floor(rows/2) && c === Math.floor(cols/2) && grid.cells[i].mine) el.textContent='💣';
      host.appendChild(el);
    }
  }
}

// copy / import helpers UI
function openPasteModalWithText(text){
  document.getElementById('pasteInput').value = text || '';
  openPasteModal();
}

// init & zoom/pan (frame-level)
function setupZoomPan(){
  const frame = document.getElementById('minefieldFrame');
  const container = document.getElementById('minefieldContainer');
  if (!frame || !container) return;
  view.scale = 0.6; view.tx = 0; view.ty = 0;
  renderBoard();

  // panning with delayed capture
  let dragging=false, maybeDrag=null; const DRAG_THRESHOLD=6;
  frame.addEventListener('pointerdown', (e)=>{ if (e.pointerType==='mouse' && e.button !== 0) return; maybeDrag = {pointerId:e.pointerId, startX:e.clientX, startY:e.clientY, startTx:view.tx, startTy:view.ty}; });
  frame.addEventListener('pointermove', (e)=>{
    if (maybeDrag && maybeDrag.pointerId === e.pointerId && !dragging){
      const dx = e.clientX - maybeDrag.startX, dy = e.clientY - maybeDrag.startY;
      if (Math.hypot(dx,dy) > DRAG_THRESHOLD){ dragging=true; frame.setPointerCapture && frame.setPointerCapture(e.pointerId); }
      else return;
    }
    if (dragging && maybeDrag && maybeDrag.pointerId === e.pointerId){
      const dx = e.clientX - maybeDrag.startX, dy = e.clientY - maybeDrag.startY;
      view.tx = maybeDrag.startTx + dx; view.ty = maybeDrag.startTy + dy; renderBoard();
    }
  });
  function endPointer(e){ if (maybeDrag && maybeDrag.pointerId === e.pointerId){ dragging=false; maybeDrag=null; frame.releasePointerCapture && frame.releasePointerCapture(e.pointerId); } }
  frame.addEventListener('pointerup', endPointer); frame.addEventListener('pointercancel', endPointer); frame.addEventListener('pointerleave', endPointer);

  // pinch with two pointers
  const pointers = new Map();
  function dist(a,b){ const dx=b.clientX - a.clientX, dy = b.clientY - a.clientY; return Math.hypot(dx,dy); }
  frame.addEventListener('pointerdown', e=> pointers.set(e.pointerId,e));
  frame.addEventListener('pointermove', e=>{ if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId,e); if (pointers.size===2){ const it = pointers.values(); const a = it.next().value, b = it.next().value; const d = dist(a,b); if (frame._lastD==null) frame._lastD = d; const ratio = d / frame._lastD; frame._lastD = d; view.scale = Math.max(0.1, Math.min(6, view.scale * ratio)); renderBoard(); }});
  function clearPointer(e){ pointers.delete(e.pointerId); frame._lastD = null; }
  frame.addEventListener('pointerup', clearPointer); frame.addEventListener('pointercancel', clearPointer); frame.addEventListener('pointerout', clearPointer); frame.addEventListener('pointerleave', clearPointer);

  // wheel zoom anywhere in frame
  frame.addEventListener('wheel', (e)=>{ if (Math.abs(e.deltaY) > Math.abs(e.deltaX)){ const delta = -e.deltaY; const factor = 1 + Math.sign(delta) * Math.min(0.14, Math.abs(delta)/600); view.scale = Math.max(0.1, Math.min(6, view.scale * factor)); e.preventDefault(); renderBoard(); return; } }, { passive:false });

  // keyboard
  frame.addEventListener('keydown', (e)=>{ if (e.key === '+' || e.key === '='){ view.scale = Math.min(6, view.scale * 1.12); renderBoard(); } if (e.key === '-' || e.key === '_'){ view.scale = Math.max(0.1, view.scale / 1.12); renderBoard(); } if (e.key === '0'){ view.scale = 1; view.tx=0; view.ty=0; renderBoard(); } });
}

// startup
function init(){
  loadAll();
  wireControls();
  populateCustomAdjToDropdown();
  setupZoomPan();
  if (!gameGrid) startNewGame();
  renderBoard();

  // modal tab switching
  document.querySelectorAll('#adjModal .tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{ document.querySelectorAll('#adjModal .tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); document.querySelectorAll('#adjModal .tabpane').forEach(p=>p.classList.remove('active')); document.getElementById(btn.dataset.tab + 'Tab').classList.add('active'); });
  });

  // clicking outside paste modal closes it
  document.getElementById('pasteModal').addEventListener('click', (e)=>{ if (e.target === e.currentTarget) closePasteModal(); });
  document.getElementById('adjModal').addEventListener('click', (e)=>{ if (e.target === e.currentTarget) closeAdjModal(); });
}

document.addEventListener('DOMContentLoaded', init);
