// app.js — final fixes (rigid triangle transforms, constant stroke, inverse label scaling, select contrast)
const TILINGS = {
  square: { label: "Square", adjacencies: { "square-8": { label: "Square 8 (all 8)", offsets: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] }, "von-neumann": { label: "Von Neumann (4)", offsets: [[-1,0],[1,0],[0,-1],[0,1]] } } },
  triangle_right: { label: "Right Triangle (zig)", adjacencies: { "triR-edge": { label: "Edges (3)", offsets: null }, "triR-r2": { label: "Radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() } } },
  triangle_equi: { label: "Equilateral Triangle (diamond pairs)", adjacencies: { "triE-edge": { label: "Edges (3)", offsets: null }, "triE-edgev": { label: "Edges+vertices (6)", offsets: null }, "triE-r2": { label: "Radius 2", offsets: (function(){ const o=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) o.push([dr,dc]); return o; })() } } },
  hex: { label: "Hexagon", adjacencies: { "hex-6": { label: "Hex 6 (standard)", offsets: [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]] } } }
};

const NUMBER_COLORS = {1:'#3ec7ff',2:'#ff6b6b',3:'#ffd27a',4:'#a88cff',5:'#ff9fb3',6:'#7ce7ff',7:'#d3d3d3',8:'#b0c4de'};

let gameGrid = null;
let running = false;
let firstClick = true;
let currentTiling = null;
let currentAdjacency = null;
let debugEnabled = false;
let debugEl = null;

function idx(rows, cols, r, c){ return r * cols + c; }
function inBounds(rows, cols, r, c){ return r >= 0 && r < rows && c >= 0 && c < cols; }
function createGrid(rows, cols){ return { rows, cols, cells: Array(rows*cols).fill(0).map(()=>({ mine:false, revealed:false, flagged:false, count:0 })) }; }

/* ---------- adjacency helpers ---------- */
function triangleRightOffsets(r,c,adjKey){
  const rightPointing = ((r + c) % 2) === 0;
  if (adjKey === 'triR-edge') return rightPointing ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  const arr=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
}
function triangleEquiOffsets(r,c,adjKey){
  const up = ((r + c) % 2) === 0;
  if (adjKey === 'triE-edge') return up ? [[0,-1],[1,0],[0,1]] : [[0,-1],[-1,0],[0,1]];
  if (adjKey === 'triE-edgev') return up ? [[0,-1],[-1,0],[1,0],[0,1],[-1,1],[1,-1]] : [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,1]];
  const arr=[]; for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) if(!(dr===0&&dc===0)) arr.push([dr,dc]); return arr;
}
function getOffsetsFor(tilingKey, adjacencyKey){
  if (tilingKey === 'triangle_right' || tilingKey === 'triangle_equi') return null;
  return (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies[adjacencyKey] && TILINGS[tilingKey].adjacencies[adjacencyKey].offsets) || [];
}

/* ---------- counts & mines ---------- */
function computeCountsWithAdjacency(grid, tilingKey, adjacencyKey){
  const { rows, cols, cells } = grid;
  if (tilingKey === 'triangle_right'){
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }
      const offs = triangleRightOffsets(r,c,adjacencyKey);
      let cnt=0; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
    return;
  }
  if (tilingKey === 'triangle_equi'){
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const i = idx(rows,cols,r,c);
      if (cells[i].mine) { cells[i].count = -1; continue; }
      const offs = triangleEquiOffsets(r,c,adjacencyKey);
      let cnt=0; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
      cells[i].count = cnt;
    }
    return;
  }
  const offsets = getOffsetsFor(tilingKey, adjacencyKey);
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
    const i = idx(rows,cols,r,c);
    if (cells[i].mine) { cells[i].count = -1; continue; }
    let cnt=0; for (const [dr,dc] of offsets){ const rr=r+dr, cc=c+dc; if (!inBounds(rows,cols,rr,cc)) continue; if (cells[idx(rows,cols,rr,cc)].mine) cnt++; }
    cells[i].count = cnt;
  }
}

function placeMines(grid, mineCount, tilingKey, adjacencyKey, safeCell = null){
  const { rows, cols, cells } = grid;
  cells.forEach(cell => { cell.mine=false; cell.count=0; cell.revealed=false; cell.flagged=false; });
  const total = rows * cols;
  const perm = Array.from({ length: total }, (_,i) => i);
  for (let i=total-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }

  const forbidden = new Set();
  if (safeCell){
    const [sr,sc] = safeCell;
    let offs = [];
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(sr,sc,adjacencyKey).concat([[0,0]]);
    else offs = getOffsetsFor(tilingKey, adjacencyKey).concat([[0,0]]);
    for (const [dr,dc] of offs){ const rr=sr+dr, cc=sc+dc; if (!inBounds(rows,cols,rr,cc)) continue; forbidden.add(idx(rows,cols,rr,cc)); }
  }

  let placed=0,k=0,maxPlace=Math.min(mineCount,total-1);
  while (placed<maxPlace && k<total){ const pos=perm[k++]; if (forbidden.has(pos)) continue; cells[pos].mine=true; placed++; }
  grid.mines = placed;
  computeCountsWithAdjacency(grid, tilingKey, adjacencyKey);
}

/* ---------- reveal / flag ---------- */
function revealCell(grid,r,c,tilingKey,adjacencyKey){
  const { rows, cols, cells } = grid;
  if (!inBounds(rows,cols,r,c)) return { changed: [], exploded:false };
  const i = idx(rows,cols,r,c);
  const cell = cells[i];
  if (!cell || cell.revealed || cell.flagged) return { changed: [], exploded:false };
  if (cell.mine) { cell.revealed = true; return { changed:[[r,c]], exploded:true }; }

  const changed=[]; const stack=[[r,c]];
  while (stack.length){
    const [rr,cc] = stack.pop(); const ii = idx(rows,cols,rr,cc); const cl = cells[ii];
    if (!cl || cl.revealed || cl.flagged) continue;
    cl.revealed=true; changed.push([rr,cc]);
    let offs;
    if (tilingKey === 'triangle_right') offs = triangleRightOffsets(rr,cc,adjacencyKey);
    else if (tilingKey === 'triangle_equi') offs = triangleEquiOffsets(rr,cc,adjacencyKey);
    else offs = getOffsetsFor(tilingKey, adjacencyKey);
    if (cl.count === 0){
      for (const [dr,dc] of offs){ const nr=rr+dr, nc=cc+dc; if (!inBounds(rows,cols,nr,nc)) continue; const ni=idx(rows,cols,nr,nc); if (!cells[ni].revealed && !cells[ni].flagged) stack.push([nr,nc]); }
    }
  }
  return { changed, exploded:false };
}
function toggleFlag(grid,r,c){ const {rows,cols,cells}=grid; if(!inBounds(rows,cols,r,c)) return null; const i=idx(rows,cols,r,c); const cell=cells[i]; if(!cell||cell.revealed) return null; cell.flagged=!cell.flagged; return cell.flagged; }
function countFlaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){ let offs; if (tilingKey==='triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey); else if (tilingKey==='triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey); else offs = getOffsetsFor(tilingKey, adjacencyKey); let cnt=0; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; if (grid.cells[idx(grid.rows,grid.cols,rr,cc)].flagged) cnt++; } return cnt; }
function revealUnflaggedNeighbors(grid,r,c,tilingKey,adjacencyKey){ let offs; if (tilingKey==='triangle_right') offs = triangleRightOffsets(r,c,adjacencyKey); else if (tilingKey==='triangle_equi') offs = triangleEquiOffsets(r,c,adjacencyKey); else offs = getOffsetsFor(tilingKey, adjacencyKey); const toReveal=[]; for (const [dr,dc] of offs){ const rr=r+dr, cc=c+dc; if (!inBounds(grid.rows,grid.cols,rr,cc)) continue; const cell = grid.cells[idx(grid.rows,grid.cols,rr,cc)]; if (!cell.flagged && !cell.revealed) toReveal.push([rr,cc]); } return toReveal; }
function checkWin(grid){ return grid.cells.every(cell => (cell.mine && cell.flagged) || (!cell.mine && cell.revealed)); }

/* ---------- SVG / geometry helpers ---------- */
function makeSvgElement(tag, attrs={}){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; }
function pointsToStr(points){ return points.map(p=>`${p[0]},${p[1]}`).join(' '); }
function computeSquarePolygon(cx,cy,size){ const s=size/2; return [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]]; }
function computeHexPolygon(cx,cy,radius){ const pts=[]; for (let k=0;k<6;k++){ const angle=k*Math.PI/3; pts.push([cx+radius*Math.cos(angle), cy+radius*Math.sin(angle)]); } return pts; }

/* ---------- lattices (triangles) + helpers ---------- */
function buildZigLattice(rows, cols, s, PAD = 8){
  const h = Math.sqrt(3)/2 * s;
  const vertexRows = rows + 1;
  const vertexCols = cols * 2 + 1;
  const vertices = [];
  for (let vr=0; vr<vertexRows; vr++){
    const y = PAD + vr * h;
    const offset = (vr % 2) ? s/2 : 0;
    for (let vc=0; vc<vertexCols; vc++){
      const x = PAD + offset + vc * (s/2);
      vertices.push({ x,y,vr,vc });
    }
  }
  const vCols = vertexCols;
  const vIndex = (vr,vc) => Math.max(0, Math.min(vertexRows-1, vr)) * vCols + Math.max(0, Math.min(vCols-1, vc));
  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const baseVc = c*2;
      const up = ((r + c) % 2) === 0;
      if (up) triIndex.push({ r,c,upward:true, verts:[ vIndex(r, baseVc+1), vIndex(r+1, baseVc), vIndex(r+1, baseVc+2) ] });
      else triIndex.push({ r,c,upward:false, verts:[ vIndex(r+1, baseVc+1), vIndex(r, baseVc), vIndex(r, baseVc+2) ] });
    }
  }
  const last = vertices[vertices.length-1];
  const w = last ? last.x + s/2 + PAD : (cols * s + PAD*2);
  const H = (vertexRows - 1) * h + PAD*2 + h;
  const centers = computeTriangleCenters(vertices, triIndex);
  return { vertices, triIndex, w, h: H, centers, PAD };
}

function buildDiamondEqui(rows, cols, s, PAD = 8){
  const h = Math.sqrt(3)/2 * s;
  const vertexRows = rows + 1;
  const vertexCols = cols * 2 + 1;
  const vertices = [];
  for (let vr=0; vr<vertexRows; vr++){
    const y = PAD + vr * h;
    const offset = (vr % 2) ? s/2 : 0;
    for (let vc=0; vc<vertexCols; vc++){
      const x = PAD + offset + vc * (s/2);
      vertices.push({ x,y,vr,vc });
    }
  }
  const vCols = vertexCols;
  const vIndex = (vr,vc) => Math.max(0, Math.min(vertexRows-1, vr)) * vCols + Math.max(0, Math.min(vCols-1, vc));
  const triIndex = [];
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const baseVc = c*2;
      const up = ((r + c) % 2) === 0;
      if (up) triIndex.push({ r,c,upward:true, verts:[ vIndex(r, baseVc+1), vIndex(r+1, baseVc), vIndex(r+1, baseVc+2) ] });
      else triIndex.push({ r,c,upward:false, verts:[ vIndex(r+1, baseVc+1), vIndex(r, baseVc), vIndex(r, baseVc+2) ] });
    }
  }
  const last = vertices[vertices.length-1];
  const w = last ? last.x + s/2 + PAD : (cols * s + PAD*2);
  const H = (vertexRows - 1) * h + PAD*2 + h;
  const centers = computeTriangleCenters(vertices, triIndex);
  return { vertices, triIndex, w, h: H, centers, PAD };
}

function computeTriangleCenters(vertices, triIndex){
  return triIndex.map(t => {
    const pts = t.verts.map(i => vertices[i]);
    const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
    const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
    return { r: t.r, c: t.c, cx, cy };
  });
}

function translatePoints(points, dx, dy){ return points.map(p => [p.x + dx, p.y + dy]); }
function scalePointsAround(points, cx, cy, scale){
  return points.map(p => {
    const x = (p.x - cx) * scale + cx;
    const y = (p.y - cy) * scale + cy;
    return { x, y };
  });
}

/* ---------- Render ---------- */
function renderTiledBoard(){
  const appRoot = document.getElementById('appRoot');
  if (!appRoot || !gameGrid) return;
  appRoot.innerHTML = '';
  if (debugEl) debugEl.remove();

  const rows = gameGrid.rows, cols = gameGrid.cols;
  const rawBase = Math.floor(720 / Math.max(8, cols));
  const baseSize = Math.max(10, Math.min(56, rawBase));
  const tileType = currentTiling || 'square';

  // read UI values fresh each render
  const zoom = Math.max(0.1, Math.min(2.0, Number((document.getElementById('zoomSlider')||{value:1}).value || 1)));
  const gapX = Number((document.getElementById('xGapSlider')||{value:1}).value || 1);
  const gapY = Number((document.getElementById('yGapSlider')||{value:1}).value || 1);
  debugEnabled = !!(document.getElementById('debugToggle') && document.getElementById('debugToggle').checked);

  const STROKE_WIDTH = 1.25; // constant stroke width regardless of zoom
  const LABEL_FONT_CAP = 20; // px cap for label font size

  // For labels we want readable size independent of zoom.
  // Use inverse scaling: visualFont = baseFont / zoom, capped.
  const baseLabel = Math.max(10, baseSize / 4);

  if (tileType === 'triangle_right'){
    const lattice = buildZigLattice(rows, cols, baseSize, 8);
    const { vertices, triIndex, w: svgW, h: svgH, centers, PAD } = lattice;

    // compute view extents based on zoom and gaps
    const viewW = svgW * zoom * gapX;
    const viewH = svgH * zoom * gapY;
    const svg = makeSvgElement('svg', { width: viewW, height: viewH, viewBox: `0 0 ${viewW} ${viewH}` });
    svg.style.maxWidth='100%'; svg.style.height='auto'; svg.style.display='block'; svg.style.margin='0 auto';

    const transformPoint = (x,y) => {
      const tx = ((x - PAD) * zoom) * gapX + PAD * zoom * gapX;
      const ty = ((y - PAD) * zoom) * gapY + PAD * zoom * gapY;
      return { x: tx, y: ty };
    };

    for (let t=0; t<triIndex.length; t++){
      const ti = triIndex[t];
      const r = ti.r, c = ti.c;
      const ptsBase = ti.verts.map(i => vertices[i]); // {x,y}
      const baseCenter = { x: (ptsBase[0].x + ptsBase[1].x + ptsBase[2].x)/3, y: (ptsBase[0].y + ptsBase[1].y + ptsBase[2].y)/3 };

      // STEP 1: scale triangle about its centroid by zoom (so geometry scales uniformly)
      // NOTE: scaling here is geometric zoom (tile size changes), not gap deformation.
      const scaled = scalePointsAround(ptsBase, baseCenter.x, baseCenter.y, zoom);

      // STEP 2: compute where the base centroid *should* be after gapX/gapY and zoom
      const desiredCenter = transformPoint(baseCenter.x, baseCenter.y);

      // find centroid of scaled points
      const centroidScaled = { x:(scaled[0].x + scaled[1].x + scaled[2].x)/3, y:(scaled[0].y + scaled[1].y + scaled[2].y)/3 };

      // STEP 3: compute delta and translate scaled points rigidly
      const dx = desiredCenter.x - centroidScaled.x;
      const dy = desiredCenter.y - centroidScaled.y;
      const finalPts = scaled.map(p => [p.x + dx, p.y + dy]);

      // render polygon with constant stroke
      const poly = makeSvgElement('polygon', { points: pointsToStr(finalPts), stroke:'var(--accent)', 'stroke-width': STROKE_WIDTH, 'stroke-linejoin':'round', fill:'rgba(2,10,20,0.88)' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
      if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      poly.classList.add('tile');

      // label: keep readable size by inverse-scaling with zoom
      const rawFont = baseLabel / Math.max(0.5, zoom);
      const fontSize = Math.min(LABEL_FONT_CAP, Math.max(8, rawFont));
      const lx = (finalPts[0][0]+finalPts[1][0]+finalPts[2][0])/3;
      const ly = (finalPts[0][1]+finalPts[1][1]+finalPts[2][1])/3 + 4;

      const label = makeSvgElement('text', { x: lx, y: ly, 'text-anchor':'middle', 'font-size': fontSize });
      if (cell.revealed) {
        if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
        else label.textContent='';
      } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

      (function(r,c){
        poly.addEventListener('click', ()=> {
          if (!running) return;
          if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
          const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
          if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard();
        });
        poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
      })(r,c);

      svg.appendChild(poly);
      svg.appendChild(label);
    }

    appRoot.appendChild(svg);
    if (debugEnabled) addDebugOverlay(`verts:${vertices.length} tris:${triIndex.length} gapX:${gapX.toFixed(2)} gapY:${gapY.toFixed(2)} zoom:${zoom.toFixed(2)}`);
    return;
  }

  if (tileType === 'triangle_equi'){
    const lattice = buildDiamondEqui(rows, cols, baseSize, 8);
    const { vertices, triIndex, w: svgW, h: svgH, centers, PAD } = lattice;
    const viewW = svgW * zoom * gapX;
    const viewH = svgH * zoom * gapY;
    const svg = makeSvgElement('svg', { width: viewW, height: viewH, viewBox: `0 0 ${viewW} ${viewH}` });
    svg.style.maxWidth='100%'; svg.style.height='auto'; svg.style.display='block'; svg.style.margin='0 auto';

    const transformPoint = (x,y) => {
      const tx = ((x - PAD) * zoom) * gapX + PAD * zoom * gapX;
      const ty = ((y - PAD) * zoom) * gapY + PAD * zoom * gapY;
      return { x: tx, y: ty };
    };

    for (let t=0; t<triIndex.length; t++){
      const ti = triIndex[t];
      const r = ti.r, c = ti.c;
      const ptsBase = ti.verts.map(i => vertices[i]);
      const baseCenter = { x: (ptsBase[0].x + ptsBase[1].x + ptsBase[2].x)/3, y: (ptsBase[0].y + ptsBase[1].y + ptsBase[2].y)/3 };

      const scaled = scalePointsAround(ptsBase, baseCenter.x, baseCenter.y, zoom);
      const desiredCenter = transformPoint(baseCenter.x, baseCenter.y);
      const centroidScaled = { x:(scaled[0].x + scaled[1].x + scaled[2].x)/3, y:(scaled[0].y + scaled[1].y + scaled[2].y)/3 };
      const dx = desiredCenter.x - centroidScaled.x;
      const dy = desiredCenter.y - centroidScaled.y;
      const finalPts = scaled.map(p => [p.x + dx, p.y + dy]);

      const poly = makeSvgElement('polygon', { points: pointsToStr(finalPts), stroke:'var(--accent)', 'stroke-width': STROKE_WIDTH, 'stroke-linejoin':'round', fill:'rgba(4,18,30,0.9)' });
      const cell = gameGrid.cells[idx(rows,cols,r,c)];
      if (cell.revealed) poly.setAttribute('fill','rgba(18,44,60,0.95)');
      if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
      if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');
      poly.classList.add('tile');

      const baseLabel = Math.max(10, baseSize / 4);
      const fontSize = Math.min(LABEL_FONT_CAP, Math.max(8, baseLabel / Math.max(0.5, zoom)));
      const lx = (finalPts[0][0]+finalPts[1][0]+finalPts[2][0])/3;
      const ly = (finalPts[0][1]+finalPts[1][1]+finalPts[2][1])/3 + 4;
      const label = makeSvgElement('text', { x: lx, y: ly, 'text-anchor':'middle', 'font-size': fontSize });

      if (cell.revealed) {
        if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
        else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
        else label.textContent='';
      } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

      (function(r,c){
        poly.addEventListener('click', ()=> {
          if (!running) return;
          if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid,minesVal,currentTiling,currentAdjacency,[r,c]); firstClick=false; }
          const res = revealCell(gameGrid,r,c,currentTiling,currentAdjacency);
          if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
          else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
          renderTiledBoard();
        });
        poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
      })(r,c);

      svg.appendChild(poly);
      svg.appendChild(label);
    }

    appRoot.appendChild(svg);
    if (debugEnabled) addDebugOverlay(`verts:${vertices.length} tris:${triIndex.length} gapX:${gapX.toFixed(2)} gapY:${gapY.toFixed(2)} zoom:${zoom.toFixed(2)}`);
    return;
  }

  // fallback: square / hex - translate centers rigidly based on gapX/gapY and zoom
  const gapXc = gapX;
  const gapYc = gapY;
  const zoomc = zoom;

  let centersInfo;
  if (currentTiling === 'hex') centersInfo = hexCenter(rows, cols, (baseSize/2) * zoomc);
  else centersInfo = squareCenter(rows, cols, baseSize * zoomc);

  const svg = makeSvgElement('svg', { width: centersInfo.w * gapXc, height: centersInfo.h * gapYc, viewBox: `0 0 ${centersInfo.w * gapXc} ${centersInfo.h * gapYc}` });
  svg.style.maxWidth='100%'; svg.style.height='auto'; svg.style.display='block'; svg.style.margin='0 auto';

  for (const cellInfo of centersInfo.centers){
    const r = cellInfo.r, c = cellInfo.c;
    const cx = cellInfo.x * gapXc;
    const cy = cellInfo.y * gapYc;
    let pts;
    if (currentTiling === 'hex') pts = computeHexPolygon(cx, cy, (baseSize/2) * zoomc);
    else pts = computeSquarePolygon(cx, cy, baseSize * zoomc);

    const poly = makeSvgElement('polygon', { points: pointsToStr(pts), stroke:'var(--accent)', 'stroke-width': STROKE_WIDTH, 'stroke-linejoin':'round', fill:'rgba(2,10,20,0.9)' });
    const cell = gameGrid.cells[idx(rows,cols,r,c)];
    if (cell.revealed) poly.setAttribute('fill','rgba(10,28,40,0.95)');
    if (cell.flagged) poly.setAttribute('fill','rgba(60,20,20,0.95)');
    if (cell.mine && cell.revealed) poly.setAttribute('fill','rgba(140,50,40,0.98)');

    const fontSize = Math.min(LABEL_FONT_CAP, Math.max(8, (baseSize/4) / Math.max(0.5, zoomc)));
    const label = makeSvgElement('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': fontSize });
    if (cell.revealed) {
      if (cell.mine) { label.textContent='💣'; label.setAttribute('fill','#fff'); }
      else if (cell.count>0) { label.textContent=String(cell.count); label.setAttribute('fill', NUMBER_COLORS[cell.count]||'#9be7ff'); }
      else label.textContent='';
    } else if (cell.flagged) { label.textContent='🚩'; label.setAttribute('fill','#ffb86b'); } else label.textContent='';

    (function(r,c){
      poly.addEventListener('click', ()=> {
        if (!running) return;
        if (cell.revealed && cell.count > 0) {
          const flagged = countFlaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
          if (flagged === cell.count) {
            const toReveal = revealUnflaggedNeighbors(gameGrid, r, c, currentTiling, currentAdjacency);
            let exploded=false;
            for (const [ar,ac] of toReveal){ const res = revealCell(gameGrid, ar, ac, currentTiling, currentAdjacency); if (res.exploded) exploded=true; }
            if (exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — a mine was revealed during chord'; }
            else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
            renderTiledBoard(); return;
          }
          return;
        }
        if (firstClick) { const minesVal = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10)); placeMines(gameGrid, minesVal, currentTiling, currentAdjacency, [r,c]); firstClick=false; }
        const res = revealCell(gameGrid, r, c, currentTiling, currentAdjacency);
        if (res.exploded) { running=false; gameGrid.cells.forEach(cl=>{ if (cl.mine) cl.revealed=true; }); const ms=document.getElementById('msStatus'); if (ms) ms.textContent='BOOM — you hit a mine'; }
        else { if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } else { const ms=document.getElementById('msStatus'); if (ms) ms.textContent='Playing...'; } }
        renderTiledBoard();
      });
      poly.addEventListener('contextmenu', (e)=> { e.preventDefault(); if (!running) return; toggleFlag(gameGrid,r,c); if (checkWin(gameGrid)){ running=false; const ms=document.getElementById('msStatus'); if (ms) ms.textContent='You win!'; } renderTiledBoard(); });
    })(r,c);

    svg.appendChild(poly);
    svg.appendChild(label);
  }

  appRoot.appendChild(svg);
}

/* debug overlay helper */
function addDebugOverlay(text){
  debugEl = document.createElement('div');
  debugEl.className = 'debug-overlay';
  debugEl.textContent = text;
  const root = document.getElementById('appRoot');
  root.appendChild(debugEl);
}

/* ---------- centers helpers ---------- */
function squareCenter(rows, cols, size){ const PAD=8; const centers=[]; for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){ const x = c*size + size/2 + PAD; const y = r*size + size/2 + PAD; centers.push({r,c,x,y}); } return { centers, w: cols*size + 16, h: rows*size + 16 }; }
function hexCenter(rows, cols, radius){ const R = radius; const hexWidth = 2*R; const hexHeight = Math.sqrt(3)*R; const xStep = 1.5*R; const yStep = hexHeight; const centers=[]; const PAD=8; for(let r=0;r<rows;r++){ for(let c=0;c<cols;c++){ const x = c*xStep + R + PAD; const y = r*yStep + ((c&1)?(hexHeight/2):0) + R + PAD; centers.push({r,c,x,y}); } } const w = (cols-1)*xStep + hexWidth + PAD*2; const h = (rows-1)*yStep + hexHeight + PAD*2; return { centers, w, h }; }

/* ---------- controls wiring ---------- */
function startNewGame(){
  const rows = Math.max(3, Number((document.getElementById('msRows')||{value:9}).value || 9));
  const cols = Math.max(3, Number((document.getElementById('msCols')||{value:9}).value || 9));
  let mines = Math.max(1, Number((document.getElementById('msMines')||{value:10}).value || 10));
  mines = Math.min(mines, rows*cols - 1);

  gameGrid = createGrid(rows, cols);
  running = true; firstClick = true;
  const statusEl = document.getElementById('msStatus'); if (statusEl) statusEl.textContent = 'Ready — first click is safe';

  currentTiling = (document.getElementById('tilingSelect')||{}).value || Object.keys(TILINGS)[0];
  currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || Object.keys(TILINGS[currentTiling].adjacencies)[0];

  computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency);
  renderTiledBoard();
  try { window.gameGrid = gameGrid; window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; window.TILINGS = TILINGS; } catch(e){}
}

function populateTilingControls(){
  const sel = document.getElementById('tilingSelect'); const adjSel = document.getElementById('adjacencySelect');
  if (!sel || !adjSel) return;
  sel.innerHTML = '';
  for (const key of Object.keys(TILINGS)){ const opt = document.createElement('option'); opt.value = key; opt.textContent = TILINGS[key].label; sel.appendChild(opt); }

  function populateAdj(tilingKey){
    adjSel.innerHTML = '';
    const adj = (TILINGS[tilingKey] && TILINGS[tilingKey].adjacencies) || {};
    for (const aKey of Object.keys(adj)){ const o = document.createElement('option'); o.value = aKey; o.textContent = adj[aKey].label; adjSel.appendChild(o); }
    if (adjSel.options.length) adjSel.selectedIndex = 0;
  }

  const initial = sel.value || Object.keys(TILINGS)[0];
  populateAdj(initial);
  currentTiling = initial;
  currentAdjacency = adjSel.value || (adjSel.options[0] && adjSel.options[0].value);

  sel.__robust_change_handler && sel.removeEventListener('change', sel.__robust_change_handler);
  adjSel.__robust_change_handler && adjSel.removeEventListener('change', adjSel.__robust_change_handler);

  const tilingHandler = function(){
    const newTiling = (document.getElementById('tilingSelect')||{}).value;
    populateAdj(newTiling);
    currentTiling = newTiling;
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value || currentAdjacency;
    const statusEl = document.getElementById('msStatus');
    if (statusEl){
      const label = (TILINGS[currentTiling] && TILINGS[currentTiling].label) || currentTiling;
      const adjLabel = (TILINGS[currentTiling] && TILINGS[currentTiling].adjacencies && TILINGS[currentTiling].adjacencies[currentAdjacency] && TILINGS[currentTiling].adjacencies[currentAdjacency].label) || currentAdjacency;
      statusEl.textContent = `Tiling: ${label} (Adjacency: ${adjLabel})`;
    }
    if (gameGrid) { try { computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); } catch(e){ console.error(e); startNewGame(); } }
    try { window.currentTiling = currentTiling; window.currentAdjacency = currentAdjacency; } catch(e){}
  };
  sel.__robust_change_handler = tilingHandler; sel.addEventListener('change', tilingHandler);

  const adjacencyHandler = function(){
    currentAdjacency = (document.getElementById('adjacencySelect')||{}).value;
    try { window.currentAdjacency = currentAdjacency; } catch(e){}
    if (gameGrid) { try { computeCountsWithAdjacency(gameGrid, currentTiling, currentAdjacency); renderTiledBoard(); } catch(e){ console.error(e); } }
  };
  adjSel.__robust_change_handler = adjacencyHandler; adjSel.addEventListener('change', adjacencyHandler);
}

function applyAdjacencyAction(){ const sel=document.getElementById('tilingSelect'); const adjSel=document.getElementById('adjacencySelect'); if (!sel||!adjSel) return; currentTiling=sel.value; currentAdjacency=adjSel.value; try{ window.currentTiling=currentTiling; window.currentAdjacency=currentAdjacency; }catch(e){}; if (gameGrid){ computeCountsWithAdjacency(gameGrid,currentTiling,currentAdjacency); renderTiledBoard(); const ms=document.getElementById('msStatus'); if (ms) ms.textContent = `Applied ${TILINGS[currentTiling].label} + ${TILINGS[currentTiling].adjacencies[currentAdjacency].label}`; } }
function newGameAction(){ startNewGame(); }

function initOnceDomReady(){
  populateTilingControls();

  const applyBtn = document.getElementById('applyAdjacency'); const newBtn = document.getElementById('newGame');
  if (applyBtn){ applyBtn.removeEventListener('click', applyAdjacencyAction); applyBtn.addEventListener('click', applyAdjacencyAction); }
  if (newBtn){ newBtn.removeEventListener('click', newGameAction); newBtn.addEventListener('click', newGameAction); }

  // wire settings controls
  const zoomSlider = document.getElementById('zoomSlider'); const xGap = document.getElementById('xGapSlider'); const yGap = document.getElementById('yGapSlider');
  const zoomValue = document.getElementById('zoomValue'); const xGapValue = document.getElementById('xGapValue'); const yGapValue = document.getElementById('yGapValue');
  const themeSelect = document.getElementById('themeSelect'); const debugBox = document.getElementById('debugToggle');

  if (zoomSlider && zoomValue){
    zoomSlider.addEventListener('input', ()=> {
      zoomValue.value = Number(zoomSlider.value).toFixed(2);
      renderTiledBoard();
    });
    zoomValue.addEventListener('blur', ()=> {
      let v = Number(zoomValue.value);
      if (Number.isNaN(v) || v <= 0) v = Number(zoomSlider.value);
      const newRange = Math.max(0.1, Math.min(2.0, v));
      zoomSlider.value = newRange;
      zoomValue.value = Number(zoomSlider.value).toFixed(2);
      renderTiledBoard();
    });
  }

  if (xGap && xGapValue){
    xGap.addEventListener('input', ()=> { xGapValue.value = Number(xGap.value).toFixed(2); renderTiledBoard(); });
    xGapValue.addEventListener('blur', ()=> { let v=Number(xGapValue.value); if (Number.isNaN(v) || v<=0) v=Number(xGap.value); xGap.value = v; xGapValue.value = Number(xGap.value).toFixed(2); renderTiledBoard(); });
  }

  if (yGap && yGapValue){
    yGap.addEventListener('input', ()=> { yGapValue.value = Number(yGap.value).toFixed(2); renderTiledBoard(); });
    yGapValue.addEventListener('blur', ()=> { let v=Number(yGapValue.value); if (Number.isNaN(v) || v<=0) v=Number(yGap.value); yGap.value = v; yGapValue.value = Number(yGap.value).toFixed(2); renderTiledBoard(); });
  }

  if (themeSelect) themeSelect.addEventListener('change', ()=> { document.body.setAttribute('data-theme', themeSelect.value || 'dark-ocean'); renderTiledBoard(); });
  if (debugBox) debugBox.addEventListener('change', ()=> { debugEnabled = !!debugBox.checked; renderTiledBoard(); });

  const status = document.getElementById('msStatus'); if (status) status.textContent = 'Ready — select tiling and click New Game';
  startNewGame();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initOnceDomReady); else setTimeout(initOnceDomReady, 0);

try { window.renderTiledBoard = renderTiledBoard; window.startNewGame = startNewGame; window.TILINGS = TILINGS; } catch(e){}
