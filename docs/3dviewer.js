// docs/3dviewer.js — minimal three.js slice viewer (voxel cubes)
importPresetsAndInit();

async function importPresetsAndInit() {
  // load presets
  const res = await fetch('./shape-presets.json', { cache: 'no-store' });
  if (!res.ok) { document.getElementById('threeMsg').textContent = 'Failed to load presets'; return; }
  const presets = await res.json();

  const showBtn = document.getElementById('show3dBtn');
  const root = document.getElementById('threeRoot');
  const sliceEl = document.getElementById('slice3dInput');
  const msg = document.getElementById('threeMsg');

  // three.js essentials
  let scene, camera, renderer, controls, cubesGroup;
  function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, root.clientWidth / root.clientHeight, 0.1, 2000);
    camera.position.set(10, 10, 18);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(root.clientWidth, root.clientHeight);
    renderer.setClearColor(0x021023, 1);
    root.appendChild(renderer.domElement);

    // simple orbit controls fallback (very small): rotate on drag
    let isDown=false, lastX=0, lastY=0;
    renderer.domElement.addEventListener('pointerdown', e=>{ isDown=true; lastX=e.clientX; lastY=e.clientY; });
    window.addEventListener('pointerup', ()=>isDown=false);
    window.addEventListener('pointermove', e=>{
      if (!isDown) return;
      const dx=(e.clientX-lastX)*0.01, dy=(e.clientY-lastY)*0.01;
      scene.rotation.y += dx; scene.rotation.x += dy;
      lastX=e.clientX; lastY=e.clientY;
    });

    const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(5,10,7); scene.add(dir);

    cubesGroup = new THREE.Group(); scene.add(cubesGroup);

    window.addEventListener('resize', ()=>{
      camera.aspect = root.clientWidth / root.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(root.clientWidth, root.clientHeight);
    });

    animate();
  }

  function animate() {
    requestAnimationFrame(animate);
    renderer && renderer.render(scene, camera);
  }

  function clearCubes() {
    if (!cubesGroup) return;
    while (cubesGroup.children.length) {
      const c = cubesGroup.children.pop();
      c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  function addVoxel(x,y,z,color=0x9be7ff) {
    const g = new THREE.BoxGeometry(1,1,1);
    const m = new THREE.MeshStandardMaterial({ color, metalness:0.1, roughness:0.6 });
    const mesh = new THREE.Mesh(g,m);
    mesh.position.set(x, y, z);
    cubesGroup.add(mesh);
  }

  function showSliceFromPreset(presetId, sliceIndex = 0) {
    const preset = presets.find(p=>p.id === presetId);
    if (!preset) { msg.textContent = 'Preset not found'; return; }
    const cells = expandPresetToCells(preset);
    // assume last axis is depth; show cells where lastAxis == sliceIndex
    const D = preset.dims;
    const depthAxis = D - 1;
    const sliceCells = cells.filter(c => c[depthAxis] === Number(sliceIndex));
    if (!sliceCells.length) msg.textContent = `No cells at ${depthAxis} = ${sliceIndex}`; else msg.textContent = `Rendering ${sliceCells.length} voxels`;
    clearCubes();
    // center around origin
    const xs = sliceCells.map(s=>s[0]), ys = sliceCells.map(s=>s[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    for (const c of sliceCells) {
      const x = c[0] - minX - ( (Math.max(...xs)-minX)/2 );
      const y = c[1] - minY - ( (Math.max(...ys)-minY)/2 );
      addVoxel(x, -y, 0); // flip Y for screen-space feel
    }
    // adjust camera distance
    const spread = Math.max(6, Math.max(Math.max(...xs)-minX+1, Math.max(...ys)-minY+1));
    camera.position.set(spread, spread, spread*1.6);
    camera.lookAt(0,0,0);
  }

  function expandPresetToCells(preset) {
    if (preset.type === 'explicit') return preset.cells;
    if (preset.type === 'implicit') {
      const dims = preset.dims;
      const cells=[];
      const R = preset.rule.radius ?? 1;
      const limits = Array(dims).fill(0).map(()=>({min:-R,max:R}));
      function recur(coord,i){
        if (i===dims){
          const manhattan = coord.reduce((s,v)=>s+Math.abs(v),0);
          if (preset.rule.type === 'manhattan' && manhattan <= R) cells.push(coord.slice());
          if (preset.rule.type === 'hyperplane' && coord[preset.rule.axis || (dims-1)] === (preset.rule.value || 0)) cells.push(coord.slice());
          if (preset.rule.type === 'hexagon' && dims===2){
            const x=coord[0], y=coord[1];
            if (Math.abs(x)+Math.abs(y)+Math.abs(x+y) <= 2*(preset.rule.radius||1)) cells.push(coord.slice());
          }
          return;
        }
        for (let v=limits[i].min; v<=limits[i].max; v++){ coord[i]=v; recur(coord,i+1); }
      }
      recur(Array(dims).fill(0),0);
      return cells;
    }
    if (preset.type === 'generator' && preset.params && preset.params.type === 'hypercube') {
      const size = preset.params.size || 2, dims = preset.dims;
      const cells=[];
      const recur=(coord,i)=>{ if (i===dims){ cells.push(coord.slice()); return; } for (let v=0; v<size; v++){ coord[i]=v; recur(coord,i+1); } };
      recur(Array(dims).fill(0),0);
      return cells;
    }
    return preset.cells || [];
  }

  // init three on first open
  showBtn.addEventListener('click', ()=>{
    if (!root) return;
    if (!renderer) { initThree(); }
    root.style.display = 'block';
    const sel = document.getElementById('presetSelect');
    const presetId = sel ? sel.value : (presets[0] && presets[0].id);
    const sliceVal = Number(sliceEl.value || 0);
    showSliceFromPreset(presetId, sliceVal);
  });

  // allow slice change while open
  sliceEl.addEventListener('change', ()=>{
    const sel = document.getElementById('presetSelect');
    const presetId = sel ? sel.value : (presets[0] && presets[0].id);
    if (!presetId) return;
    showSliceFromPreset(presetId, Number(sliceEl.value));
  });
}
