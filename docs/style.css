:root{
  --bg-0: #021017;
  --panel: linear-gradient(180deg,#071219,#041018);
  --accent: #0ea5b3;
  --muted: rgba(255,255,255,0.08);
  --text: #d9f7ff;
  --sub: #bfefff;
  --select-bg: #0a1823;
  --select-text: #d9f7ff;
  --select-hover: #122938;
}

body[data-theme="dark-ocean"]{
  --bg-0:#021017; --panel:linear-gradient(180deg,#071219,#041018); --accent:#0ea5b3; --text:#d9f7ff; --sub:#bfefff; --muted:rgba(255,255,255,0.06);
  --select-bg:#0a1823; --select-text:#d9f7ff; --select-hover:#122938;
}

*{ box-sizing:border-box; }
html,body{ height:100%; margin:0; font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial; background:var(--bg-0); color:var(--text); }

.controls{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:12px; background:var(--panel); border-bottom:1px solid var(--muted); position:sticky; top:0; z-index:60; }
.control-group{ display:flex; gap:8px; align-items:center; }
label{ font-size:13px; color:var(--sub); }
input[type="number"], select, .value-input{ background: var(--select-bg); border:1px solid rgba(255,255,255,0.04); color:var(--select-text); padding:7px 8px; border-radius:8px; min-width:72px; font-size:13px; }
select{ min-width:140px; }
select option{ background:var(--select-bg); color:var(--select-text); }
select:focus, input:focus{ outline: 2px solid rgba(14,165,179,0.14); outline-offset:1px; }

.value-input{ width:80px; text-align:center; cursor:text; }

.ms-btn{ font-size:13px; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); background:linear-gradient(#0b1220,#061018); color:var(--sub); cursor:pointer; }
.ms-btn.primary{ background: linear-gradient(var(--accent), #0b98ad); color:#042426; font-weight:600; }
#msStatus{ padding:8px 12px; font-size:13px; color:var(--sub); }

/* viewport-style frame */
.minefield-window { position:relative; width:100%; height:calc(100vh - 96px); display:flex; justify-content:center; align-items:flex-start; padding:16px; overflow:hidden; }
.minefield-shell { width: min(1200px, 96%); max-width:1200px; display:flex; justify-content:center; }
.minefield-frame { position:relative; width:100%; height: calc(100vh - 140px); border-radius:12px; border: 2px solid rgba(14,165,179,0.18); background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.03)); display:flex; align-items:center; justify-content:center; overflow: visible; }

/* the scalable content */
.minefield-container { transform-origin: center center; transition: transform 120ms ease; display:inline-block; position:relative; padding:12px; overflow: visible; touch-action: none; }

/* svg */
#minefieldSvg { display:block; width:auto; height:auto; max-width:none; background:transparent; }

/* responsive */
@media (max-width:760px){
  .controls{ gap:6px; }
  .minefield-frame{ height: calc(100vh - 220px); }
}
