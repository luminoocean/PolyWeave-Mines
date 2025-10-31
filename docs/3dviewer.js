// docs/3dviewer.js — improved three.js slice viewer with multi-slice rendering
// This module is intentionally self-contained and safe for Pages (no bundler).

(async function initViewer(){

  // load presets
  let presets;
  try {
    const r = await fetch('./shape-presets.json', {cache:'no-store'});
    presets = await r.json();
  } catch (e) {
    const msg = document.getElementById('threeMsg');
    if (msg) msg.textContent = 'Failed to load presets';
    console.error(e);
    return;
  }

  // DOM refs
  const btnOpen = document.getElementById('show3dBtn');
  const root = document.getElementById('threeRoot');
  const sliceEl = document.getElementById('slice3dInput');
  const status = document.getElementById('threeMsg');
  const presetSelect = document.getElementById('presetSelect');

  // three.js variables
  let scene, camera, renderer, cubesGroup, raf;

  // utilities: expand presets to explicit cells (returns array of coordinate arrays)
  function expandPresetToCells(preset) {
    if (!preset) return [];
    if (preset.type === 'explicit' && Array.isArray(preset.cells)) return preset.cells.map(c => c.slice());
    if (preset.type === 'generator' && preset.params && preset.params.type === 'hypercube') {
      const size = preset.params.size || 2, dims = preset.dims;
      const cells = [];
      const recur=(coord,i)=>{ if (i===dims){ cells.push(coord.slice()); return; } for (let v=0; v<size; v++){ coord[i]=v; recur(coord,i+1); } };
      recur(Array(dims).fill(0),0);
      return cells;
    }
    if (preset.type === 'implicit' && preset.rule) {
      const dims = preset.dims;
      const cells=[];
      // choose reasonable limits for implicit: if rule provides radius/min/max use them; otherwise fallback to [-2..2]
      let limits = Array(dims).fill(null).map(()=>({min:-2,max:2}));
      if (preset.rule.radius !== undefined) {
        limits = Array(dims).fill(null).map(()=>({min: -preset.rule.radius, max: preset.rule.radius}));
      }
      if (preset.rule.min !== undefined || preset.rule.max !== undefined) {
        const mi = preset.rule.min ?? -2, ma = preset.rule.max ?? 2;
        limits = Array(dims).fill(null).map(()=>({min:mi,max:ma}));
      }

      function matchesRule(coord) {
        const rule = preset.rule;
        if (rule.type === 'manhattan') {
          const R = rule.radius ?? 1;
          return coord.reduce((s,v)=>s+Math.abs(v),0) <= R;
        }
        if (rule.type === 'hyperplane') {
          const axis = rule.axis ?? (dims - 1);
          const val = rule.value ?? 0;
          return coord[axis] === val;
        }
        if (rule.type === 'hexagon' && dims === 2) {
          const x=coord[0], y=coord[1];
          return Math.abs(x)+Math.abs(y)+Math.abs(x+y) <= 2*(rule.radius ?? 1);
        }
        if (rule.type === 'shell') {
          const dist = coord.reduce((s,v)=>s+Math.abs(v),0);
          const min = rule.min ?? 1, max = rule.max ?? 2;
          return dist >= min && dist <= max;
        }
        return false;
      }

      function recur(coord,i){
        if (i===dims){
          if (matchesRule(coord)) cells.push(coord.slice());
          return;
        }
        for (let v = limits[i].min; v <= limits[i].max; v++){
          coord[i]=v; recur(coord,i+1);
        }
      }
      recur(Array(dims).fill(0), 0);
      return cells;
    }
    return preset.cells ? preset.cells.map(c=>c.slice()) : [];
  }

  // compute per-axis min/max for an array of cells
  function axisRanges(cells, dims) {
    const mins = Array(dims).fill(Infinity), maxs = Array(dims).fill(-Infinity);
    for (const c of cells) {
      for (let i=0;i<dims;i++){
        const v = c[i] ?? 0;
        if (v < mins[i]) mins[i] = v;
        if (v > maxs[i]) maxs[i] = v;
      }
    }
    // if empty, return zeros
    for (let i=0;i<dims;i++){
      if (mins[i] === Infinity) { mins[i]=0; maxs[i]=0; }
    }
    return {mins, maxs};
  }

  // three.js setup (created on first open)
  function ensureThree() {
    if (renderer) return;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, root.clientWidth / root.clientHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(root.clientWidth, root.clientHeight);
    renderer.setClearColor(0x021023, 1);
    root.appendChild(renderer.domElement);

    // basic orbit-like pointer rotate
    let isDown=false, lastX=0, lastY=0;
    renderer.domElement.addEventListener('pointerdown', (e)=>{ isDown=true; lastX=e.clientX; lastY=e.clientY; renderer.domElement.setPointerCapture(e.pointerId); });
    window.addEventListener('pointerup', ()=>{ isDown=false; });
    window.addEventListener('pointermove', (e)=>{
      if (!isDown) return;
      const dx=(e.clientX-lastX)*0.01, dy=(e.clientY-lastY)*0.01;
      scene.rotation.y += dx; scene.rotation.x += dy;
      lastX=e.clientX; lastY=e.clientY;
    });

    const amb = new THREE.AmbientLight(0xffffff, 0.7); scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.5); dir.position.set(5,10,7); scene.add(dir);

    cubesGroup = new THREE.Group(); scene.add(cubesGroup);

    window.addEventListener('resize', ()=>{
      camera.aspect = root.clientWidth / root.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(root.clientWidth, root.clientHeight);
    });

    // animation loop
    function loop(){
      raf = requestAnimationFrame(loop);
      renderer && renderer.render(scene, camera);
    }
    loop();
  }

  // dispose cubes
  function clearCubes() {
    if (!cubesGroup) return;
    while (cubesGroup.children.length) {
      const c = cubesGroup.children.pop();
      try { c.geometry.dispose(); } catch(e){}
      try { if (c.material) c.material.dispose(); } catch(e){}
    }
  }

  // add a voxel cube at (x,y,z) — allow color and opacity
  function addVoxel(x,y,z, color=0x9be7ff, opacity=1.0) {
    const size = 1;
    const geom = new THREE.BoxGeometry(size,size,size);
    const mat = new THREE.MeshStandardMaterial({ color, metalness:0.1, roughness:0.7, transparent: opacity < 1, opacity });
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    cubesGroup.add(m);
  }

 // (replace the existing updateSliceInfo function and any slice min/max assignment logic with this)

function updateSliceInfo() {
  const id = presetSelect ? presetSelect.value : presets[0] && presets[0].id;
  const preset = presets.find(p=>p.id===id);
  if (!preset) { status.textContent = 'No preset'; return; }
  const cells = expandPresetToCells(preset);
  const dims = preset.dims || (cells[0] ? cells[0].length : 2);
  const ranges = axisRanges(cells, dims);
  const depthAxis = dims - 1;

  // coerce to integer bounds for slice controls
  const intMin = Math.floor(Number(ranges.mins[depthAxis] ?? 0));
  const intMax = Math.ceil(Number(ranges.maxs[depthAxis] ?? 0));

  // apply integer bounds to the input attributes
  sliceEl.min = intMin;
  sliceEl.max = intMax;

  // clamp and coerce current value to integer
  let current = Number(sliceEl.value) || 0;
  current = Math.max(intMin, Math.min(intMax, Math.round(current)));
  sliceEl.value = current;

  status.textContent = `Preset ${preset.id} axis ${depthAxis} valid ${intMin}..${intMax}`;
}

    // compute valid slice min/max on depthAxis
    const sliceMin = ranges.mins[depthAxis], sliceMax = ranges.maxs[depthAxis];

    // bounds check for sliceIndex
    if (sliceIndex < sliceMin || sliceIndex > sliceMax) {
      status.textContent = `No cells at axis ${depthAxis} = ${sliceIndex} (valid ${sliceMin}..${sliceMax})`;
      return;
    }

    // collect sliceIndices to render (symmetric block)
    const half = Math.floor((thickness-1)/2);
    const sliceIndices = [];
    for (let offset = -half; offset <= half; offset++) {
      const s = sliceIndex + offset;
      if (s >= sliceMin && s <= sliceMax) sliceIndices.push(s);
    }

    // pick subset of cells whose depthAxis value is in sliceIndices
    const sliceSet = new Set(sliceIndices.map(String));
    const sliceCells = cells.filter(c => sliceSet.has(String(c[depthAxis])));

    if (sliceCells.length === 0) {
      status.textContent = `No cells in selected slices (${sliceIndices.join(',')})`;
      return;
    }

    // determine 2D extents for visible axes (first two axes used for layout)
    const xs = sliceCells.map(c => c[0] ?? 0), ys = sliceCells.map(c => c[1] ?? 0), zs = sliceCells.map(c => c[depthAxis] ?? 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    // center coordinates around origin
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

    // sampling: color varies by depth (so overlapping slices are visually distinct)
    const depthSpan = Math.max(1, maxZ - minZ + 1);

    // add voxels. place z coordinate as depth offset so multiple slices visible
    for (const c of sliceCells) {
      const x = c[0] - cx;
      const y = -(c[1] - cy); // flip y for screen-like orientation
      const z = (c[depthAxis] - cz); // depth offset
      // color ramp by normalized depth
      const norm = (c[depthAxis] - minZ) / depthSpan;
      const base = new THREE.Color(0x9be7ff);
      const dark = new THREE.Color(0x0a6a7f);
      const color = base.lerp(dark, norm * 0.6);
      const opacity = thickness > 1 ? 0.9 - (Math.abs(c[depthAxis] - sliceIndex) * 0.2) : 1.0;
      addVoxel(x, y, z, color.getHex(), opacity);
    }

    // update camera to cover bounding box
    const spreadX = maxX - minX + 1;
    const spreadY = maxY - minY + 1;
    const spreadZ = Math.max(1, maxZ - minZ + 1);
    const maxSpread = Math.max(spreadX, spreadY, spreadZ);
    const distance = Math.max(6, maxSpread * 1.8);
    camera.position.set(distance, distance, distance);
    camera.lookAt(0,0,0);

    status.textContent = `Rendered ${sliceCells.length} voxels; axis ${depthAxis} valid ${sliceMin}..${sliceMax}; showing slices ${sliceIndices.join(',')}`;
  }

  // wire UI
  function wireUI() {
    // ensure presetSelect is populated (app.js may have already done it; populate if empty)
    if (presetSelect && presetSelect.children.length === 0) {
      presets.forEach(p => {
        const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.id} (${p.dims}D)`;
        presetSelect.appendChild(o);
      });
      if (presets.length) presetSelect.value = presets[0].id;
    }

    // show available slice range when preset changes
    function updateSliceInfo() {
      const id = presetSelect ? presetSelect.value : presets[0] && presets[0].id;
      const preset = presets.find(p=>p.id===id);
      if (!preset) { status.textContent = 'No preset'; return; }
      const cells = expandPresetToCells(preset);
      const dims = preset.dims || (cells[0] ? cells[0].length : 2);
      const ranges = axisRanges(cells, dims);
      const depthAxis = dims - 1;
      sliceEl.min = ranges.mins[depthAxis];
      sliceEl.max = ranges.maxs[depthAxis];
      // clamp current value
      if (Number(sliceEl.value) < Number(sliceEl.min)) sliceEl.value = sliceEl.min;
      if (Number(sliceEl.value) > Number(sliceEl.max)) sliceEl.value = sliceEl.max;
      status.textContent = `Preset ${preset.id} axis ${depthAxis} valid ${sliceEl.min}..${sliceEl.max}`;
    }

    if (presetSelect) presetSelect.addEventListener('change', updateSliceInfo);
    if (presetSelect) presetSelect.addEventListener('change', ()=> {
      // also auto-render 2D in the main app if available
      const renderBtn = document.getElementById('renderBtn');
      if (renderBtn) renderBtn.click();
    });

    // show button opens viewer and renders current slice block
    btnOpen && btnOpen.addEventListener('click', ()=>{
      ensureThree();
      root.style.display = 'block';
      const presetId = presetSelect ? presetSelect.value : presets[0] && presets[0].id;
      const preset = presets.find(p=>p.id===presetId);
      const sliceIndex = Number(sliceEl.value || 0);
      const thicknessEl = document.getElementById('viewerThickness');
      const thickness = thicknessEl ? Math.max(1, Number(thicknessEl.value || 1)) : 1;
      renderSlicesForPreset(preset, sliceIndex, thickness);
    });

    // allow slice changes while open
    sliceEl && sliceEl.addEventListener('change', ()=>{
      const presetId = presetSelect ? presetSelect.value : presets[0] && presets[0].id;
      const preset = presets.find(p=>p.id===presetId);
      const sliceIndex = Number(sliceEl.value || 0);
      const thicknessEl = document.getElementById('viewerThickness');
      const thickness = thicknessEl ? Math.max(1, Number(thicknessEl.value || 1)) : 1;
      ensureThree();
      renderSlicesForPreset(preset, sliceIndex, thickness);
    });

    // add small thickness control to the UI if not already present
    if (!document.getElementById('viewerThickness')) {
      const container = document.getElementById('viewer3d');
      if (container) {
        const controlsRow = container.querySelector('div');
        const label = document.createElement('label');
        label.style.color = '#9bb4c9';
        label.style.marginLeft = '8px';
        label.textContent = 'Thickness';
        const input = document.createElement('input');
        input.id = 'viewerThickness'; input.type = 'number'; input.value = '1'; input.min = '1'; input.style.width='60px'; input.style.marginLeft='6px';
        label.appendChild(input);
        controlsRow.appendChild(label);
      }
    }

    // initial preset info
    updateSliceInfo();
  }

  // initialize
  wireUI();

  // expose for debug on window
  window.__poly_presets = presets;

})();
