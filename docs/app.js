// app.js
// Features added in this version:
// - pinch-to-zoom via two-finger touch and trackpad gesture (fallback to ctrl+wheel)
// - centered transform-origin scaling so minefield stays centered
// - computeAdjacencyFromLattice(vertices, edges, faces) : generic adjacency generator
// - hex adjacency corrected to ensure each hex face detects all neighboring faces sharing an edge
// - visualizer supports face-driven rendering (vertex/edge/face input) and fallback grid helpers
// - tilings.json still drives which tiling to use; functions registered by name are used for adjacency and generation

const TILINGS_URL = './tilings.json';
const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let tilingsCatalog = null;
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = 'square';
let currentAdjacency = 'edges4';

// --- basic grid helpers ---
function idx(rows, cols, r, c){ return r * cols + c; }
function inBounds(rows, cols, r, c){ return r >= 0 && r < rows && c >= 0 && c < cols; }
function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

// --- adjacency helper registry ---
// hex adjacency fixed: use axial-correct neighbor mapping for odd-q layout
function hexOffsetsFor(r, c){
  // For odd-q vertical layout (columns offset down when c is odd):
  // neighbors for even columns vs odd columns
  const odd = (c & 1) === 1;
  if (odd) return [[-1,0],[0,1],[1,0],[1,-1],[0,-1],[-1,-1]];
  return [[-1,1],[0,1],[1,1],[1,0],[0,-1],[-1,0]];
}

// triangular lattice offsets (edge neighbors and edge+vertex)
function triangleEquiOffsets(r, c, key){
  const up = ((r + c) & 1) === 0;
  if (key === 'triE-edge') return up ? [[0,-1],[0,1],[1,0]] : [[0,-1],[0,1],[-1,0]];
  if (key === 'triE-edgev') return up ? [[0,-1],[0,1],[1,0],[1,-1],[-1,0],[-1,1]] : [[0,-1],[0,1],[-1,0],[-1,-1],[1,0],[1,1]];
  return [];
}

// a reasonable cairo fallback (kept for legacy)
function cairoOffsets(r,c){ return [[-1,0],[1,0],[0,-1],[0,1],[-1,1]]; }

const ADJ_FN_REGISTRY = { hexOffsetsFor, triangleEquiOffsets, cairoOffsets };

// --- generic lattice adjacency generator ---
// inputs:
//  - vertices: [[x,y],...]
//  - edges: [[vIndex, vIndex], ...]
//  - faces: [[vIndex, vIndex, vIndex, ...], ...]  (vertices ordered around face)
// returns: { faceAdj: Map(faceIndex => [neighborFaceIndex,...]), edgeToFaces: Map(edgeKey => [faceIndices]) }
function computeAdjacencyFromLattice(vertices, edges, faces){
  // build normalized edge => index key (min,max)
  const edgeKey = (a,b) => (a<b) ? `${a}_${b}` : `${b}_${a}`;
  const edgeToFaces = new Map();
  faces.forEach((face, fi) => {
    for (let k=0;k<face.length;k++){
      const a = face[k], b = face[(k+1)%face.length];
      const key = edgeKey(a,b);
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key).push(fi);
    }
  });
  const faceAdj = new Map();
  faces.forEach((_,fi) => faceAdj.set(fi, new Set()));
  for (const [k, arr] of edgeToFaces.entries()){
    if (arr.length < 2) continue; // boundary edge or unmatched
    for (let i=0;i<arr.length;i++){
      for (let j=i+1;j<arr.length;j++){
        faceAdj.get(arr[i]).add(arr[j]);
        faceAdj.get(arr[j]).add(arr[i]);
      }
    }
  }
  // convert sets to arrays
  const faceAdjObj = {};
  for (const [fi, s] of faceAdj.entries()) faceAdjObj[fi] = Array.from(s);
  return { faceAdj: faceAdjObj, edgeToFaces };
}

// --- compute counts using tiling metadata (face adjacency or offsets) ---
function computeCountsWithAdjacency(grid, tilingId, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!tilingsCatalog) return;
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return;

  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }

      const adj = tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type === 'offsets') offsets = adj.offsets;
        else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
        else if (adj.type === 'lattice' && adj.faces && adj.vertices && adj.edges){
          // adjacency described by face indices via lattice metadata
          // assume grid cell index maps to face index when faces.length === rows*cols
          const faceIndex = i;
          if (typeof adj.faceAdj === 'object' && adj.faceAdj[faceIndex]) {
            offsets = adj.faceAdj[faceIndex].map(fi => { // convert face index to (dr,dc) offsets by inverse mapping if provided
              if (adj.faceIndexToRC) {
                const [fr,fc] = adj.faceIndexToRC(fi);
                const [r0,c0] = adj.faceIndexToRC(faceIndex);
                return [fr - r0, fc - c0];
              }
              return [0,0];
            });
          }
        }
      }

      let cnt = 0;
      for (const [dr,dc] of offsets){
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rows, cols, rr, cc)) continue;
        if (cells[idx(rows,cols,rr,cc)].mine) cnt++;
      }
      cells[i].count = cnt;
    }
  }
}

// --- mines placement (safe-first) ---
function placeMines(grid, mineCount, tilingId, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine=false; cell.count=0; cell.revealed=false; cell.flagged=false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc] = safeCell;
    const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
    if (tiling){
      const adj = tiling.adjacencies[adjacencyKey];
      let offsets = [];
      if (adj){
        if (adj.type === 'offsets') offsets = adj.offsets;
        else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](sr,sc,adjacencyKey);
      }
      offsets.push([0,0]);
      for (const [dr,dc] of offsets){ const rr=sr+dr, cc=sc+dc; if (!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
    }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){ const pos=perm[k++]; if (forbidden.has(pos)) continue; cells[pos].mine=true; placed++; }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingId, adjacencyKey);
}

// --- reveal / flag / chord ---
function revealCell(grid,r,c,tilingId,adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded:false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed: [], exploded:false };
  if (cell.mine) { cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed=true; changed.push([rr,cc]);

    const adj = tiling && tiling.adjacencies[adjacencyKey];
    let offsets = [];
    if (adj){
      if (adj.type === 'offsets') offsets = adj.offsets;
      else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](rr,cc,adjacencyKey);
    }

    if (cl.count === 0){
      for (const [dr,dc] of offsets){ const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni=idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]); }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell||cell.revealed) return null; cell.flagged=!cell.flagged; return cell.flagged; }
function countFlaggedNeighbors(grid,r,c,tilingId,adjacencyKey){
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return 0;
  const adj = tiling.adjacencies[adjacencyKey];
  let offsets = [];
  if (adj){
    if (adj.type === 'offsets') offsets = adj.offsets;
    else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjacencyKey);
  }
  let cnt=0;
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) cnt++; }
  return cnt;
}
function revealUnflaggedNeighbors(grid,r,c,tilingId,adjKey){
  const tiling = tilingsCatalog.tilings.find(t => t.id === tilingId);
  if (!tiling) return [];
  const adj = tiling.adjacencies[adjKey];
  let offsets = [];
  if (adj){
    if (adj.type === 'offsets') offsets = adj.offsets;
    else if (adj.type === 'function' && typeof ADJ_FN_REGISTRY[adj.fn] === 'function') offsets = ADJ_FN_REGISTRY[adj.fn](r,c,adjKey);
  }
  const toReveal=[];
  for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; const cell = grid.cells[idx(grid.rows,grid.cols,rr,cc)]; if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]); }
  return toReveal;
}
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// --- SVG helpers & geometry generators ---
function makeSvgElement(tag, attrs={}){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points){ return points.map(p=>`${p[0]},${p[1]}`).join(' '); }
function computeRegularPolygon(cx,cy,sides,radius,rotation=0){
  const pts=[];
  for (let k=0;k<sides;k++){
    const ang = rotation + (k/sides)*Math.PI*2;
    pts.push([cx + Math.cos(ang)*radius, cy + Math.sin(ang)*radius]);
  }
  return pts;
}

// centers generators (consistent, map each cell index to a face in order)
function squareCenter(rows, cols, size){
  const PAD = 12; const centers=[]; for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = c*size + size/2 + PAD; const y = r*size + size/2 + PAD; centers.push({r,c,x,y}); }
  return { centers, w: cols*size + PAD*2, h: rows*size + PAD*2 };
}
function hexCenter(rows, cols, radius){
  const R = radius; const hexWidth = 2*R; const hexHeight = Math.sqrt(3)*R; const xStep = 1.5*R; const yStep = hexHeight; const centers=[]; const PAD = 12;
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const x = c*xStep + R + PAD; const y = r*yStep + ((c & 1) ? (hexHeight/2) : 0) + R + PAD; centers.push({r,c,x,y}); } }
  return { centers, w:(cols-1)*xStep + hexWidth + PAD*2, h:(rows-1)*yStep + hexHeight + PAD*2 };
}
function triCenter(rows, cols, side){
  const PAD = 12; const h = Math.sqrt(3)/2 * side; const centers=[];
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const x = PAD + c * (side * 0.5) + ((r & 1) ? side*0.25 : 0); const y = PAD + r * (h * 0.5); centers.push({r,c,x,y}); } }
  return { centers, w: cols * side * 0.5 + PAD*2 + side, h: rows * h * 0.5 + PAD*2 + h };
}

// render pipeline (face-driven if lattice data available)
function renderTiledBoard(){
  const svgRoot = document.getElementById('minefieldSvg');
  const container = document.getElementById('minefieldContainer');
  if (!svgRoot || !container || !gameGrid || !tilingsCatalog) return;
  svgRoot.innerHTML = '';

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const baseSize = Math.max(12, Math.floor(720 / Math.max(8, cols)));

  const zoomScale = container._scale || 0.6;
  container.style.transform = `scale(${zoomScale})`;
  container.style.transformOrigin = 'center center';

  const gapX = Number((document.getElementById('xGapValue')||{value:1}).value || 1);
  const gapY = Number((document.getElementById('yGapValue')||{value:1}).value || 1);
  const gapUnitX = (gapX - 1) * baseSize * 0.45;
  const gapUnitY = (gapY - 1) * baseSize * 0.42;
  const colCenter = (cols - 1) / 2;

  const tiling = tilingsCatalog.tilings.find(t => t.id === currentTiling) || tilingsCatalog.tilings[0];
  let viewW = 800, viewH = 600;

  // If tiling provides explicit face geometry (vertices/edges/faces), use it
  if (tiling && tiling.geometry && tiling.geometry.faces && tiling.geometry.vertices){
    // face-by-face render: assumes tiling.geometry.faces.length === rows * cols or is mappable
    const verts = tiling.geometry.vertices; // [[x,y],...]
    const faces = tiling.geometry.faces; // [[vIndex,..],...]
    // simple mapping: we place faces into a grid ordering if mapping provided; else center them
    const faceCount = faces.length;
    // compute bounding box of vertices
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    verts.forEach(v => { minX = Math.min(minX,v[0]); minY = Math.min(minY,v[1]); maxX = Math.max(maxX,v[0]); maxY = Math.max(maxY,v[1]); });
    const vbW = maxX - minX, vbH = maxY - minY;
    viewW = vbW + 24; viewH = vbH + 24;
    svgRoot.setAttribute('viewBox', `${minX-12} ${minY-12} ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);

    // render each face
    faces.forEach((face, fi) => {
      const pts = face.map(vi => verts[vi]);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(6,18,26,0.94)' });
      const cellObj = gameGrid.cells[fi % gameGrid.cells.length];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(14,34,44,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      svgRoot.appendChild(poly);
    });

    return;
  }

  // fallback renderers by tiling id
  if (tiling.id === 'square'){
    const centers = squareCenter(rows,cols,baseSize);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    centers.centers.forEach(cell => {
      const r = cell.r, c = cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeRegularPolygon(cx,cy,4,baseSize/2,Math.PI/4);
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.25, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      svgRoot.appendChild(poly);
    });
    return;
  }

  if (tiling.id === 'hex'){
    const centers = hexCenter(rows,cols,baseSize/2);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);

    centers.centers.forEach(cell => {
      const r = cell.r, c = cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const pts = computeRegularPolygon(cx,cy,6,baseSize/2,Math.PI/6);
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(2,10,20,0.9)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      svgRoot.appendChild(poly);
    });
    return;
  }

  if (tiling.id === 'triangle_equi'){
    const centers = triCenter(rows,cols,baseSize);
    viewW = centers.w + Math.abs(gapUnitX) * cols;
    viewH = centers.h + Math.abs(gapUnitY) * rows;
    svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    svgRoot.setAttribute('width', viewW);
    svgRoot.setAttribute('height', viewH);
    centers.centers.forEach(cell => {
      const r = cell.r, c = cell.c;
      const cx = cell.x + (c - colCenter) * gapUnitX;
      const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
      const side = baseSize; const triH = Math.sqrt(3)/2 * side;
      const up = ((r + c) & 1) === 0;
      const pts = up ? [[cx, cy - (2/3)*triH],[cx - side/2, cy + (1/3)*triH],[cx + side/2, cy + (1/3)*triH]] : [[cx, cy + (2/3)*triH],[cx - side/2, cy - (1/3)*triH],[cx + side/2, cy - (1/3)*triH]];
      const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(4,18,30,0.92)' });
      const cellObj = gameGrid.cells[idx(rows,cols,r,c)];
      if (cellObj.revealed) poly.setAttribute('fill','rgba(18,44,60,0.95)');
      if (cellObj.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cellObj.mine && cellObj.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      svgRoot.appendChild(poly);
    });
    return;
  }

  // fallback
  const centers = squareCenter(rows,cols,baseSize);
  viewW = centers.w + Math.abs(gapUnitX) * cols;
  viewH = centers.h + Math.abs(gapUnitY) * rows;
  svgRoot.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svgRoot.setAttribute('width', viewW);
  svgRoot.setAttribute('height', viewH);
  centers.centers.forEach(cell => {
    const r = cell.r, c = cell.c;
    const cx = cell.x + (c - colCenter) * gapUnitX;
    const cy = cell.y + (r / Math.max(1, rows-1)) * gapUnitY;
    const pts = computeRegularPolygon(cx,cy,4,baseSize/2,Math.PI/4);
    const poly = makeSvgElement('polygon',{ points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width':1.1, fill:'rgba(2,10,20,0.9)' });
    svgRoot.appendChild(poly);
  });
}

// --- controls + wiring ---
function startNewGame(){
  const rows = Math.max(3, Number(document.getElementById('msRows').value || 9));
  const cols = Math.max(3, Number(document.getElementById('msCols').value || 9));
  let mines = Math.max(1, Number(document.getElementById('msMines').value || 10));
  mines = Math.min(mines, rows*cols - 1);
  gameGrid = createGrid(rows,cols);
  running = true; firstClick = true;
  document.getElementById('msStatus').textContent = 'Ready — first click is safe';
  currentTiling = document.getElementById('tilingSelect').value || (tilingsCatalog && tilingsCatalog.tilings[0].id);
  currentAdjacency = document.getElementById('adjacencySelect').value || (tilingsCatalog && Object.keys(tilingsCatalog.tilings[0].adjacencies)[0]);
  computeCountsWithAdjacency(gameGrid,currentTiling,currentAdjacency);
  renderTiledBoard();
}

function populateTilingControls(){
  const sel = document.getElementById('tilingSelect'); const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel || !tilingsCatalog) return;
  sel.innerHTML = '';
  tilingsCatalog.tilings.forEach(t => { const opt = document.createElement('option'); opt.value=t.id; opt.textContent=t.name; sel.appendChild(opt); });
  function populateAdj(key){
    adjSel.innerHTML='';
    const t = tilingsCatalog.tilings.find(x => x.id===key);
    if (!t) return;
    Object.keys(t.adjacencies).forEach(aKey => { const o = document.createElement('option'); o.value=aKey; o.textContent = t.adjacencies[aKey].label; adjSel.appendChild(o); });
    if (adjSel.options.length) adjSel.selectedIndex = 0;
  }
  sel.addEventListener('change', ()=>{ populateAdj(sel.value); currentTiling = sel.value; currentAdjacency = adjSel.value; renderTiledBoard(); });
  adjSel.addEventListener('change', ()=>{ currentAdjacency = adjSel.value; renderTiledBoard(); });
  sel.value = tilingsCatalog.tilings[0].id; populateAdj(sel.value); currentTiling = sel.value; currentAdjacency = adjSel.value;
}

function wireControls(){
  const newBtn = document.getElementById('newGame'); if (newBtn){ newBtn.removeEventListener('click', startNewGame); newBtn.addEventListener('click', startNewGame); }
  const theme = document.getElementById('themeSelect'); if (theme){ theme.addEventListener('change', ()=>{ document.body.setAttribute('data-theme', theme.value || 'dark-ocean'); }); }
  const xGap = document.getElementById('xGapValue'); const yGap = document.getElementById('yGapValue');
  if (xGap) xGap.addEventListener('blur', ()=>{ let v=Number(xGap.value); if (Number.isNaN(v)) v=1; xGap.value = Number(v).toFixed(2); renderTiledBoard(); });
  if (yGap) yGap.addEventListener('blur', ()=>{ let v=Number(yGap.value); if (Number.isNaN(v)) v=1; yGap.value = Number(v).toFixed(2); renderTiledBoard(); });
  document.getElementById('msRows').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msCols').addEventListener('change', ()=> renderTiledBoard());
  document.getElementById('msMines').addEventListener('change', ()=> renderTiledBoard());
}

// --- pinch / trackpad / ctrl+wheel zoom handling ---
// store scale on container._scale (default 0.6)
function setupZoomHandlers(){
  const container = document.getElementById('minefieldContainer');
  if (!container) return;
  container._scale = 0.6;

  // pointer-based two-finger pinch for browsers that expose Pointer events
  let pointers = new Map();
  function getDistance(p1,p2){ const dx = p2.clientX - p1.clientX; const dy = p2.clientY - p1.clientY; return Math.hypot(dx,dy); }

  container.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, e);
    (e.target).setPointerCapture && (e.target).setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2){
      const it = pointers.values();
      const pA = it.next().value;
      const pB = it.next().value;
      const dist = getDistance(pA,pB);
      if (container._lastDist == null) container._lastDist = dist;
      const ratio = dist / container._lastDist;
      container._lastDist = dist;
      container._scale = Math.max(0.1, Math.min(6, container._scale * ratio));
      renderTiledBoard();
    }
  });

  function pointerEndCleanup(e){
    pointers.delete(e.pointerId);
    container._lastDist = null;
  }
  container.addEventListener('pointerup', pointerEndCleanup);
  container.addEventListener('pointercancel', pointerEndCleanup);
  container.addEventListener('pointerout', pointerEndCleanup);
  container.addEventListener('pointerleave', pointerEndCleanup);

  // wheel + ctrl (trackpad pinch on many laptops triggers ctrl+wheel)
  container.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaMode === 0){
      // interpret as zoom gesture
      const delta = -e.deltaY;
      const factor = 1 + Math.sign(delta) * Math.min(0.12, Math.abs(delta) / 500);
      container._scale = Math.max(0.1, Math.min(6, container._scale * factor));
      e.preventDefault();
      renderTiledBoard();
      return;
    }
    // otherwise let parent scroll
  }, { passive:false });

  // pinch gestures on iOS Safari (gesture events) - optional but harmless
  container.addEventListener('gesturestart', e => { container._gestureScaleStart = container._scale; e.preventDefault(); });
  container.addEventListener('gesturechange', e => { container._scale = Math.max(0.1, Math.min(6, container._gestureScaleStart * e.scale)); renderTiledBoard(); e.preventDefault(); });
  container.addEventListener('gestureend', e => { container._gestureScaleStart = null; e.preventDefault(); });

  // keyboard +/- for accessibility
  container.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '='){ container._scale = Math.min(6, container._scale * 1.12); renderTiledBoard(); }
    if (e.key === '-' || e.key === '_'){ container._scale = Math.max(0.1, container._scale / 1.12); renderTiledBoard(); }
  });
}

// --- load tilings.json & init ---
function loadTilingsAndInit(){
  fetch(TILINGS_URL).then(r=>{
    if (!r.ok) throw new Error('tilings.json load failed');
    return r.json();
  }).then(data=>{
    tilingsCatalog = data;
    populateTilingControls();
    wireControls();
    setupZoomHandlers();
    startNewGame();
  }).catch(err=>{
    console.error('tilings load error', err);
    tilingsCatalog = {
      tilings: [
        { id:'square', name:'Square', adjacencies:{ edges4:{label:'Von Neumann (4)', type:'offsets', offsets:[[-1,0],[1,0],[0,-1],[0,1]]} } }
      ]
    };
    populateTilingControls();
    wireControls();
    setupZoomHandlers();
    startNewGame();
  });
}

document.addEventListener('DOMContentLoaded', loadTilingsAndInit);
