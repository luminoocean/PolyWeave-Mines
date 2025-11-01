// app.js — Minesweeper with Right-Triangle and Equilateral-Triangle vertex lattices
// Expects index.html to include IDs: appRoot, msRows, msCols, msMines, tilingSelect, adjacencySelect, applyAdjacency, newGame, msStatus
// Optional sliders (place near controls): xGapSlider, xGapValue, yGapSlider, yGapValue, triShrinkSlider, triShrinkValue

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
      "triE-edge": { label: "Equilateral edge neighbors", offsets: null },
      "triE-vert": { label: "Edges+vertices", offsets: null },
      "triE-r2":   { label: "Equilateral radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() }
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

// --- Module state ---
let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;

// --- small helpers ---
function idx(rows, cols, r, c){ return r*cols + c; }
function inBounds(rows, cols, r, c){ return r>=0 && r<rows && c>=0 && c<cols; }

// --- adjacency helpers for triangle logic (edge-based) ---
function triangleRightOffsets(r,c,adjKey){
  // simple local neighbor sets depending on orientation (right/left)
  // orientation: (r+c) % 2 === 0 -> right-pointing else left-pointing
  const right = ((r+c) % 2) === 0;
  if (adjKey === 'triR-edge') {
    return right ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  }
  // fallback radius neighborhood
  const arr=[];
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]);
  return arr;
}
function triangleEquiOffsets(r,c,adjKey){
  // for equilateral, we treat the grid as triangles in rows/cols like usual parity mapping
  const up = ((r+c)%2)===0;
  if (adjKey === 'triE-edge'){
    return up ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  }
  if (adjKey === 'triE-vert'){
    // edges + vertices approximated via larger neighborhood
    const arr=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
  }
  const arr=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
}

function getOffsetsFor(tilingKey, adjacencyKey){
  if (tilingKey === 'triangle_right') return null; // handled specially
  if (tilingKey === 'triangle_equi') return null; // handled specially
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

// --- grid API ---
function createGrid(rows, cols, mines=0){
  return { rows, cols, mines, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) };
}

function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (tilingKey === 'triangle_right') {
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count=-1; continue; }
      const offs = triangleRightOffsets(r,c,adjacencyKey);
      let cnt=0;
      for(const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
    return;
  }
  if (tilingKey === 'triangle_equi') {
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine){ cells[i].count=-1; continue; }
      const offs = triangleEquiOffsets(r,c,adjacencyKey);
      let cnt=0;
      for(const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
    return;
  }

  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const i = idx(rows,cols,r,c);
    if (cells[i].mine){ cells[i].count=-1; continue; }
    let cnt=0;
    for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if(!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
    cells[i].count = cnt;
  }
}

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell=null){
  const { rows, cols, cells } = grid;
  cells.forEach(c=>{ c.mine=false; c.count=0; c.revealed=false; c.flagged=false; });
  const total = rows*cols;
  const perm = Array.from({ length: total }, (_,i)=>i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc]=safeCell;
    let offs = [];
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else offs = getOffsetsFor(tilingKey, adjacencyKey).concat([[0,0]]);
    for (const [dr,dc] of offs){ const rr=sr+dr, cc=sc+dc; if(!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
  }

  let placed=0, k=0, maxPlace=Math.min(mineCount, total-1);
  while (placed<maxPlace && k<total){
    const pos = perm[k++]; if (forbidden.has(pos)) continue; cells[pos].mine=true; placed++;
  }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingKey, adjacencyKey);
}

// --- Reveal / flag / chord / win ---
function revealCell(grid,r,c,tilingKey,adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed:[], exploded:false };
  const i = idx(rows,cols,r,c); const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed:[], exploded:false };
  if (cell.mine){ cell.revealed=true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  while (stack.length){
    const [rr,cc]=stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed=true; changed.push([rr,cc]);
    let offs;
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(rr,cc,adjacencyKey);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(rr,cc,adjacencyKey);
    else offs = getOffsetsFor(tilingKey, adjacencyKey);
    if (cl.count === 0){
      for (const [dr,dc] of offs){ const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni = idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]); }
    }
  }
  return { changed, exploded:false };
}

function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell || cell.revealed) return null; cell.flagged = !cell.flagged; return cell.flagged; }
function countFlaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){
  let offs;
  if (tilingKey === 'triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey);
  else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  let cnt=0; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if(!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) cnt++; } return cnt;
}
function revealUnflaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){
  let offs;
  if (tilingKey === 'triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey);
  else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey);
  else offs = getOffsetsFor(tilingKey, adjacencyKey);
  const toReveal=[]; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if(!inBounds(grid.rows,grid.cols,rr,cc)) continue; const cell = grid.cells[idx(grid.rows,grid.cols,rr,cc)]; if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]); } return toReveal;
}
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

// --- SVG helpers ---
function makeSvgElement(tag, attrs={}) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points){ return points.map(p => `${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx,cy,size){ const s=size/2; return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]]; }
function computeHexPolygon(cx,cy,radius,gapPx=1.0){ const visualR = Math.max(1, radius - gapPx); const pts=[]; for(let k=0;k<6;k++){ const angle=k*Math.PI/3; pts.push([cx+visualR*Math.cos(angle), cy+visualR*Math.sin(angle)]); } return pts; }

// --- Vertex-lattice builders and shrink ---
function buildRightTriangleLattice(rows, cols, s, PAD=8){
  // Right-triangle lattice: grid of right isosceles triangles formed by subdividing squares.
  // We'll place vertices at a regular square lattice with step = s/2 horizontally and vertically,
  // then map each cell (r,c) to its triangle vertices according to parity.
  const step = s/2;
  const vrows = rows + 1;
  const vcols = cols + 1;
  const vertices = [];
  for (let vr=0; vr<vrows; vr++){
    for (let vc=0; vc<vcols; vc++){
      vertices.push({ x: PAD + vc*step*2, y: PAD + vr*step*2, vr, vc }); // spacing uses step*2 so side length approx s
    }
  }
  const vIndex = (vr,vc)=> vr * vcols + vc;
  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const right = ((r+c)%2)===0;
      // choose three vertices: for right-pointing we pick (r,c),(r+1,c),(r,c+1) approx
      if (right) triIndex.push({ r, c, upward: true, verts: [vIndex(r,c), vIndex(r+1,c), vIndex(r,c+1)] });
      else triIndex.push({ r, c, upward: false, verts: [vIndex(r+1,c+1), vIndex(r+1,c), vIndex(r,c+1)] });
    }
  }
  const lastV = vertices[vertices.length-1];
  const w = (vcols-1)*step*2 + PAD*2 + s*0.5;
  const h = (vrows-1)*step*2 + PAD*2 + s*0.5;
  return { vertices, triIndex, w, h };
}

function buildEquilateralVertexLattice(rows, cols, s, PAD=8){
  // Equilateral lattice: vertices form a triangular/hex lattice
  // For a grid of rows x cols triangles (one triangle per cell), we need:
  // vertexRows = rows + 1
  // vertexCols = cols + 1 (but we'll interleave; map carefully)
  // Here we'll build a vertex lattice suitable for standard triangular tiling:
  // horizontal spacing between vertices = s/2? For equilateral tessellation, place vertex grid:
  const h = Math.sqrt(3)/2 * s;
  // To tile triangles in a rows x cols layout where each cell is one triangle,
  // we construct vertex rows = rows + 1, vertex cols = cols + 1 with horizontal step = s/2 and row offsets.
  // A robust approach: use vertexRows = rows + 1, vertexCols = cols + 1 + rows (to allow interleaving)
  // Simpler and stable mapping: build vertexRows = rows + 1, vertexCols = cols + 1 + (rows%2)
  // We'll instead use a well-known mapping: vertex rows = rows + 1, vertex cols = cols*1 + 1 with offsets of s/2 every other row.
  const vertexRows = rows + 1;
  const vertexCols = cols + 1;
  const vertices = [];
  for (let vr=0; vr<vertexRows; vr++){
    const y = PAD + vr * h;
    const offset = (vr % 2) ? s/2 : 0;
    for (let vc=0; vc<vertexCols+cols; vc++){
      // we need enough columns to cover triangles; allow extra columns by using vc step s/2
      const x = PAD + offset + vc * (s/2);
      vertices.push({ x, y, vr, vc });
    }
  }
  // We need a mapping from triangle (r,c) to its 3 vertex indices.
  // A reliable mapping for a classical triangular grid (alternating up/down) is:
  // let vr = r; let baseVc = c*2;
  // upward: verts = (vr, baseVc+1), (vr+1, baseVc), (vr+1, baseVc+2)
  // downward: verts = (vr+1, baseVc+1), (vr, baseVc), (vr, baseVc+2)
  const vertexColsEffective = vertices.reduce((m,v)=>Math.max(m, v.vc),0)+1;
  const vIndex = (vr,vc) => {
    // clamp vc to 0..vertexColsEffective-1
    const vcClamped = Math.max(0, Math.min(vertexColsEffective-1, vc));
    return vr * vertexColsEffective + vcClamped;
  };
  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const vr = r;
      const baseVc = c*2;
      const up = ((r+c)%2)===0;
      if (up){
        triIndex.push({ r, c, upward:true, verts: [ vIndex(vr, baseVc+1), vIndex(vr+1, baseVc), vIndex(vr+1, baseVc+2) ] });
      } else {
        triIndex.push({ r, c, upward:false, verts: [ vIndex(vr+1, baseVc+1), vIndex(vr, baseVc), vIndex(vr, baseVc+2) ] });
      }
    }
  }
  const lastV = vertices[vertices.length-1];
  const w = lastV ? lastV.x + s + PAD : (cols * s + PAD*2);
  const hTotal = (vertexRows-1) * h + PAD*2 + h;
  // Note: vertices array may be bigger than needed; mapping uses vIndex with clamping.
  return { vertices, triIndex, w, h: hTotal, vertexColsEffective };
}

function shrinkTriangleVertices(vertsPts, shrinkPx=0){
  if (!shrinkPx) return vertsPts.map(v=>[v.x,v.y]);
  const cx = (vertsPts[0].x + vertsPts[1].x + vertsPts[2].x)/3;
  const cy = (vertsPts[0].y + vertsPts[1].y + vertsPts[2].y)/3;
  return vertsPts.map(v=>{
    const vx = cx - v.x; const vy = cy - v.y; const dist = Math.sqrt(vx*vx + vy*vy) || 1; const t = Math.min(1, shrinkPx / dist);
    return [v.x + vx*t, v.y + vy*t];
  });
}

// --- Rendering ---
function renderTiledBoard(){
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

  if (tileType === 'triangle_right'){
    const PAD = 8;
    const lattice = buildRightTriangleLattice(rows, cols, baseSize, PAD);
    const { vertices, triIndex, w: svgW, h: svgH } = lattice;
    const svg = makeSvgElement('svg', { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}` });
    svg.style.maxWidth='100%'; svg.style.height='auto'; svg.style.display='block'; svg.style.margin='0 auto';
    const triShrinkVal = Number((document.getElementById('triShrinkSlider')||{value:Math.round(baseSize*0.06)}).value || Math.round(baseSize*0.06));
    const shrinkPx = Math.max(0, triShrinkVal);

    for (const ti of triIndex){
      const r = ti.r, c = ti.c;
      const vertsPts = ti.verts.map(i => vertices[i] || { x:0,y:0 });
      const pts = shrinkTriangleVertices(vertsPts, shrinkPx);
      const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'#0ea5
