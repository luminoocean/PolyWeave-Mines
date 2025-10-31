// src/grid/index.js
function toIndex(shape, coord) {
  let idx = 0;
  for (let i = 0; i < shape.length; i++) idx = idx * shape[i] + coord[i];
  return idx;
}

function fromIndex(shape, idx) {
  const coord = Array(shape.length).fill(0);
  for (let i = shape.length - 1; i >= 0; i--) { coord[i] = idx % shape[i]; idx = Math.floor(idx / shape[i]); }
  return coord;
}

function* offsets(n) {
  const total = Math.pow(3,n);
  for (let t=0;t<total;t++){
    let x=t; const off=Array(n).fill(0); let allZero=true;
    for (let i=0;i<n;i++){ const v=(x%3)-1; off[n-1-i]=v; if (v!==0) allZero=false; x=Math.floor(x/3); }
    if (!allZero) yield off;
  }
}

function neighbors(shape, coord) {
  const res=[]; for (const off of offsets(shape.length)) { const c = coord.map((v,i)=>v+off[i]); if (c.every((v,i)=>v>=0 && v<shape[i])) res.push(c); } return res;
}

module.exports = { toIndex, fromIndex, offsets, neighbors };
