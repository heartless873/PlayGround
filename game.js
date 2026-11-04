import * as THREE from 'three';

// ============================================================
//  YOU WERE NEVER ALONE — first-person psychological horror
// ============================================================

// ---------------- PERSISTENT PROFILE ----------------
const PROFILE_KEY = 'ywna_profile_v2';
const DEFAULT_PROFILE = { glances:0, hides:{}, roomTime:{}, runs:0, endings:{}, mirrorLooks:0, loudRuns:0, tvWatches:0 };
let profile = { ...DEFAULT_PROFILE };
try { const raw = localStorage.getItem(PROFILE_KEY); if (raw) profile = { ...DEFAULT_PROFILE, ...JSON.parse(raw) }; } catch(e){}
profile.runs++;
const saveProfile = () => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch(e){} };
saveProfile();

// ---------------- STATE ----------------
const S = {
  started:false, paused:false, ended:false, phase:-1,
  hasTorch:false, hasKey:false, hasTape:false, power:false, tvOn:false,
  lightOn:false, sneak:false, hiding:null, hideReturn:null,
  unease:4, awareness:0,
  truth:{ diary:false, photo:false, tape:false },
  room:'bedroom', roomTimers:{}, lastEvent:0,
  copyRevealed:false, copyVisits:0, doubleStage:0, doubleSeen:false,
  startTime:Date.now(), behindCooldown:0, mirrorLooked:0, tvWatches:0,
  wakeT:0, heartT:0, stepT:0
};
const OBJECTIVES = [
  'Wake up. Find a light — the dresser by the window.',
  'Read the message on your phone. [TAB]',
  'The front door is locked from the inside. The spare key is in the kitchen.',
  'The deadbolt needs power. The breaker is in the study.',
  'Something turned the television on. Watch it.',
  'Find the room the television is showing. The hallway wall is not a wall.',
  'Three proofs. Now find the room the television was showing. The hallway wall is not a wall.',
  'Choose. The front door. The sofa. The mirror.'
];
const setObjective = i => {
  if (i <= S.phase) return;
  S.phase = i;
  const el = document.getElementById('objText');
  if (el) el.textContent = OBJECTIVES[Math.max(0, Math.min(i, OBJECTIVES.length-1))];
};
const updateUnease = v => {
  S.unease = THREE.MathUtils.clamp(v, 0, 100);
  const fill = document.getElementById('uneaseFill');
  const fear = document.getElementById('fear');
  if (fill) fill.style.width = S.unease + '%';
  if (fear) fear.style.opacity = (S.unease/100*0.5).toFixed(2);
};

// ---------------- AUDIO ----------------
let AC=null, master=null, amb=null, breath=null, heart=null;
function initAudio(){
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.85; master.connect(AC.destination);
    amb = AC.createGain(); amb.gain.value = 0.055; amb.connect(master);
    // room tone: low hum + faint air
    const o1 = AC.createOscillator(); o1.type='sine'; o1.frequency.value=48;
    const g1 = AC.createGain(); g1.gain.value=0.5; o1.connect(g1); g1.connect(amb); o1.start();
    const o2 = AC.createOscillator(); o2.type='sine'; o2.frequency.value=97;
    const g2 = AC.createGain(); g2.gain.value=0.06; o2.connect(g2); g2.connect(amb); o2.start();
    const air = AC.createBufferSource(); air.buffer = noiseBuffer(3); air.loop = true;
    const af = AC.createBiquadFilter(); af.type='lowpass'; af.frequency.value=380;
    const ag = AC.createGain(); ag.gain.value=0.18; air.connect(af); af.connect(ag); ag.connect(amb); air.start();
    // breathing bed (silent until triggered)
    const br = AC.createBufferSource(); br.buffer = noiseBuffer(2); br.loop = true;
    const bf = AC.createBiquadFilter(); bf.type='bandpass'; bf.frequency.value=520; bf.Q.value=1.1;
    breath = AC.createGain(); breath.gain.value=0;
    br.connect(bf); bf.connect(breath); breath.connect(master); br.start();
    const lfo = AC.createOscillator(); lfo.frequency.value=0.24;
    const lg = AC.createGain(); lg.gain.value=0.012; lfo.connect(lg); lg.connect(breath.gain); lfo.start();
    // heartbeat
    heart = AC.createGain(); heart.gain.value=0; heart.connect(master);
  } catch(e){}
}
function noiseBuffer(dur){
  const b = AC.createBuffer(1, Math.max(1, AC.sampleRate*dur|0), AC.sampleRate);
  const d = b.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  return b;
}
function panner(pos){
  if (!AC || !AC.createStereoPanner) return null;
  const p = AC.createStereoPanner();
  if (pos) {
    const v = new THREE.Vector3(pos.x-player.position.x, 0, pos.z-player.position.z);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    p.pan.value = THREE.MathUtils.clamp(v.dot(right)/(v.length()+0.001), -1, 1);
  }
  return p;
}
function playKnock(pos, vol=0.4){
  if (!AC) return;
  const t=AC.currentTime;
  const o=AC.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(170,t); o.frequency.exponentialRampToValueAtTime(62,t+0.14);
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.28);
  const p=panner(pos); o.connect(g);
  if(p){ g.connect(p); p.connect(master); } else g.connect(master);
  o.start(t); o.stop(t+0.3);
}
function playStep(vol=0.14, pos=null, low=false){
  if (!AC) return;
  const t=AC.currentTime;
  const src=AC.createBufferSource(); src.buffer=noiseBuffer(0.14);
  const f=AC.createBiquadFilter(); f.type='lowpass'; f.frequency.value= low?380:750;
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.13);
  const p=panner(pos); src.connect(f); f.connect(g);
  if(p){ g.connect(p); p.connect(master); } else g.connect(master);
  src.start(t); src.stop(t+0.16);
}
function playCreak(){
  if (!AC) return;
  const t=AC.currentTime;
  const o=AC.createOscillator(); o.type='sawtooth';
  o.frequency.setValueAtTime(120,t); o.frequency.linearRampToValueAtTime(54,t+0.9);
  const f=AC.createBiquadFilter(); f.type='bandpass'; f.frequency.value=900; f.Q.value=2;
  const g=AC.createGain(); g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(0.055,t+0.15); g.gain.exponentialRampToValueAtTime(0.0001,t+1);
  o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t+1.1);
}
function playThud(vol=0.5){
  if (!AC) return;
  const t=AC.currentTime;
  const o=AC.createOscillator(); o.frequency.setValueAtTime(58,t); o.frequency.exponentialRampToValueAtTime(28,t+0.45);
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.55);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+0.6);
}
function playWhisper(pos, dur=1.8){
  if (!AC) return;
  const t=AC.currentTime;
  const src=AC.createBufferSource(); src.buffer=noiseBuffer(dur);
  const f=AC.createBiquadFilter(); f.type='bandpass'; f.Q.value=5;
  f.frequency.setValueAtTime(700,t);
  f.frequency.linearRampToValueAtTime(2100,t+dur*0.45);
  f.frequency.linearRampToValueAtTime(520,t+dur);
  const g=AC.createGain(); g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(0.15,t+dur*0.3); g.gain.linearRampToValueAtTime(0,t+dur);
  const p=panner(pos); src.connect(f); f.connect(g);
  if(p){ g.connect(p); p.connect(master); } else g.connect(master);
  src.start(t); src.stop(t+dur+0.1);
  subtitle('— a familiar voice, from an empty room —');
}
function playSilence(dur=2.4){
  if (!AC || !amb) return;
  const t=AC.currentTime;
  amb.gain.cancelScheduledValues(t);
  amb.gain.setValueAtTime(amb.gain.value,t);
  amb.gain.linearRampToValueAtTime(0.0001,t+0.25);
  setTimeout(()=>{ if(amb){ amb.gain.linearRampToValueAtTime(0.055, AC.currentTime+1.1); } }, dur*1000);
  subtitle('— the apartment forgets how to make sound —');
}
function playStatic(vol=0.1, dur=0.9){
  if (!AC) return;
  const t=AC.currentTime;
  const src=AC.createBufferSource(); src.buffer=noiseBuffer(dur);
  const f=AC.createBiquadFilter(); f.type='highpass'; f.frequency.value=900;
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t+dur+0.05);
}
function playTape(){
  if (!AC) return;
  playStatic(0.09, 2.2);
  setTimeout(()=>{ playWhisper(null, 1.4); }, 500);
}
function updateHeartbeat(dt){
  if (!AC || !heart) return;
  const target = THREE.MathUtils.clamp((S.unease-55)/45, 0, 1);
  heart.gain.value += (target*0.12 - heart.gain.value) * Math.min(1, dt*3);
  S.heartT += dt;
  const period = 1.05 - target*0.45;
  if (S.heartT > period) {
    S.heartT = 0;
    if (target > 0.02) {
      const t = AC.currentTime;
      for (const off of [0, 0.16]) {
        const o = AC.createOscillator(); o.frequency.setValueAtTime(62,t+off);
        o.frequency.exponentialRampToValueAtTime(34,t+off+0.12);
        const g = AC.createGain(); g.gain.setValueAtTime(0.5*(1-Math.abs(off-0.08)*4),t+off);
        g.gain.exponentialRampToValueAtTime(0.001,t+off+0.18);
        o.connect(g); g.connect(heart); o.start(t+off); o.stop(t+off+0.2);
      }
    }
  }
}

// ---------------- RENDERER ----------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070a);
scene.fog = new THREE.FogExp2(0x06070a, 0.03);

const camera = new THREE.PerspectiveCamera(68, innerWidth/innerHeight, 0.05, 60);
const player = { position: new THREE.Vector3(-5.15, 1.62, -3.25), yaw: 0.02, pitch: -0.02 };
let yaw = player.yaw, pitch = player.pitch;
const clock = new THREE.Clock();

// ---------------- PROCEDURAL TEXTURES ----------------
function canvasTex(w, h, draw, repeatX=1, repeatY=1){
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const plaster = canvasTex(512,512,(x,w,h)=>{
  x.fillStyle='#a39a8c'; x.fillRect(0,0,w,h);
  for(let i=0;i<22000;i++){
    const v = 140 + Math.random()*70;
    x.fillStyle = `rgba(${v},${v-4},${v-12},${Math.random()*0.16})`;
    x.fillRect(Math.random()*w, Math.random()*h, 1.4, 1.4);
  }
  for(let i=0;i<10;i++){
    const cx=Math.random()*w, cy=Math.random()*h, r=30+Math.random()*90;
    const g=x.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,'rgba(70,60,48,0.05)'); g.addColorStop(1,'rgba(70,60,48,0)');
    x.fillStyle=g; x.fillRect(cx-r,cy-r,r*2,r*2);
  }
});
const plasterDark = canvasTex(512,512,(x,w,h)=>{
  x.fillStyle='#6f6a61'; x.fillRect(0,0,w,h);
  for(let i=0;i<16000;i++){
    const v=90+Math.random()*60;
    x.fillStyle=`rgba(${v},${v-3},${v-10},${Math.random()*0.18})`;
    x.fillRect(Math.random()*w,Math.random()*h,1.5,1.5);
  }
});
const wallpaper = canvasTex(512,512,(x,w,h)=>{
  x.fillStyle='#8d8478'; x.fillRect(0,0,w,h);
  for(let i=0;i<8000;i++){ const v=125+Math.random()*35; x.fillStyle=`rgba(${v},${v-6},${v-16},${Math.random()*0.12})`; x.fillRect(Math.random()*w,Math.random()*h,2,2); }
  x.globalAlpha=0.09; x.strokeStyle='#4a4136'; x.lineWidth=2;
  for(let i=0;i<w;i+=32){ x.beginPath(); x.moveTo(i,0); x.lineTo(i,h); x.stroke(); }
  x.globalAlpha=0.06;
  for(let i=0;i<26;i++){ const cx=Math.random()*w, cy=Math.random()*h; x.beginPath(); x.arc(cx,cy,6+Math.random()*10,0,7); x.stroke(); }
  x.globalAlpha=1;
});
const woodFloor = canvasTex(1024,1024,(x,w,h)=>{
  const planks = 8, pw = w/planks;
  for(let i=0;i<planks;i++){
    const base = 62 + Math.random()*26;
    x.fillStyle = `rgb(${base+18},${base-8},${base-30})`;
    x.fillRect(i*pw,0,pw,h);
    // grain
    for(let g=0; g<90; g++){
      const y = Math.random()*h;
      x.strokeStyle = `rgba(${base-20},${base-32},${base-44},${0.06+Math.random()*0.14})`;
      x.lineWidth = 0.6+Math.random()*1.6;
      x.beginPath(); x.moveTo(i*pw, y);
      x.bezierCurveTo(i*pw+pw*0.33, y+(Math.random()-0.5)*10, i*pw+pw*0.66, y+(Math.random()-0.5)*10, i*pw+pw, y+(Math.random()-0.5)*6);
      x.stroke();
    }
    // plank seam
    x.fillStyle='rgba(20,12,8,0.55)'; x.fillRect(i*pw,0,2,h);
    // cross seams
    for(let s=1;s<3;s++){ const yy=(h/3)*s + (Math.random()-0.5)*40; x.fillStyle='rgba(20,12,8,0.35)'; x.fillRect(i*pw,yy,pw,1.5); }
  }
},3,3);
const tiles = canvasTex(512,512,(x,w,h)=>{
  x.fillStyle='#4f4a44'; x.fillRect(0,0,w,h);
  const n=6, s=w/n;
  for(let i=0;i<n;i++) for(let j=0;j<n;j++){
    const v=150+Math.random()*30;
    x.fillStyle=`rgb(${v},${v+2},${v+4})`;
    x.fillRect(i*s+3,j*s+3,s-6,s-6);
    for(let k=0;k<40;k++){ x.fillStyle=`rgba(120,120,120,${Math.random()*0.08})`; x.fillRect(i*s+3+Math.random()*(s-6), j*s+3+Math.random()*(s-6), 2,2); }
  }
},2,2);
const fabricWeave = canvasTex(256,256,(x,w,h)=>{
  x.fillStyle='#666'; x.fillRect(0,0,w,h);
  for(let i=0;i<w;i+=2){ x.fillStyle=`rgba(150,150,150,${Math.random()*0.12})`; x.fillRect(i,0,1,h); }
  for(let j=0;j<h;j+=2){ x.fillStyle=`rgba(30,30,30,${Math.random()*0.1})`; x.fillRect(0,j,w,1); }
  for(let i=0;i<6000;i++){ const v=120+Math.random()*40; x.fillStyle=`rgba(${v},${v},${v},0.05)`; x.fillRect(Math.random()*w,Math.random()*h,1,1); }
},3,3);
const rugTex = canvasTex(512,512,(x,w,h)=>{
  x.fillStyle='#4a3436'; x.fillRect(0,0,w,h);
  x.fillStyle='#6a4c46';
  for(let i=0;i<w;i+=64) x.fillRect(i,0,32,h);
  x.strokeStyle='#8a6a56'; x.lineWidth=6; x.strokeRect(14,14,w-28,h-28);
  x.strokeStyle='#2a1c1e'; x.lineWidth=3; x.strokeRect(34,34,w-68,h-68);
  for(let i=0;i<3000;i++){ x.fillStyle=`rgba(0,0,0,${Math.random()*0.2})`; x.fillRect(Math.random()*w,Math.random()*h,2,2); }
},2,2);
const ceilingTex = canvasTex(256,256,(x,w,h)=>{
  x.fillStyle='#c9c4ba'; x.fillRect(0,0,w,h);
  for(let i=0;i<9000;i++){ const v=170+Math.random()*50; x.fillStyle=`rgba(${v},${v},${v-6},0.12)`; x.fillRect(Math.random()*w,Math.random()*h,1,1); }
},4,4);

const windowView = canvasTex(512,512,(x,w,h)=>{
  const g=x.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'#060a14'); g.addColorStop(0.42,'#0d1728'); g.addColorStop(0.75,'#1a2a44'); g.addColorStop(1,'#2b3d58');
  x.fillStyle=g; x.fillRect(0,0,w,h);
  // moon + halo
  const mx=w*0.65,my=h*0.19;
  const mg=x.createRadialGradient(mx,my,0,mx,my,110);
  mg.addColorStop(0,'rgba(232,241,255,1)'); mg.addColorStop(0.1,'rgba(198,218,250,0.85)');
  mg.addColorStop(0.4,'rgba(130,168,220,0.22)'); mg.addColorStop(1,'rgba(130,168,220,0)');
  x.fillStyle=mg; x.beginPath(); x.arc(mx,my,110,0,7); x.fill();
  x.fillStyle='#eef4ff'; x.beginPath(); x.arc(mx,my,15,0,7); x.fill();
  // thin clouds
  for (let i=0;i<7;i++){
    const cy=h*(0.1+Math.random()*0.3), cw=80+Math.random()*180;
    x.fillStyle=`rgba(120,145,190,${0.03+Math.random()*0.05})`;
    x.beginPath(); x.ellipse(Math.random()*w,cy,cw,10+Math.random()*10,0,0,7); x.fill();
  }
  // skyline
  let bx=-10;
  while (bx < w+10){
    const bw=30+Math.random()*66, bh=90+Math.random()*160;
    x.fillStyle='#070b14'; x.fillRect(bx,h-bh,bw,bh);
    // rooftop edge
    x.fillStyle='rgba(50,70,105,0.5)'; x.fillRect(bx,h-bh,bw,1.5);
    for (let wy=h-bh+13; wy<h-10; wy+=15){
      for (let wx=bx+6; wx<bx+bw-7; wx+=12){
        if (Math.random()<0.3){
          x.fillStyle=`rgba(255,198,126,${0.25+Math.random()*0.6})`;
          x.fillRect(wx,wy,3.5,4.5);
        } else if (Math.random()<0.12){
          x.fillStyle='rgba(150,190,255,0.25)';
          x.fillRect(wx,wy,3.5,4.5);
        }
      }
    }
    bx += bw + 1.5;
  }
  // haze near ground
  const hz=x.createLinearGradient(0,h*0.72,0,h);
  hz.addColorStop(0,'rgba(90,120,165,0)'); hz.addColorStop(1,'rgba(120,150,195,0.35)');
  x.fillStyle=hz; x.fillRect(0,h*0.72,w,h*0.28);
});

// ---------------- MATERIAL HELPERS ----------------
function matFrom(tex, w, h, color=0xffffff, opts={}){
  const t = tex.clone(); t.needsUpdate = true; t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(Math.max(0.5,w/2.6), Math.max(0.5,h/2.6));
  return new THREE.MeshStandardMaterial({ map:t, color, roughness:opts.roughness??0.95, metalness:opts.metalness??0 });
}
const M = {
  wallBase: plaster, wallDark: plasterDark, paper: wallpaper,
  floorWood: woodFloor, tile: tiles, fabric: fabricWeave, rug: rugTex, ceil: ceilingTex
};
const COL = { trim:0x2b2622, wood:0x4a3524, darkWood:0x2e2118, fabricA:0x7f7565, fabricB:0x5c2a2a, metal:0x8c8c90, black:0x0d0d0f };

// ---------------- GEOMETRY HELPERS ----------------
const colliders = [];
function addCollider(x, z, w, d, tag){ colliders.push({ x1:x-w/2, x2:x+w/2, z1:z-d/2, z2:z+d/2, tag }); }
function box(x,y,z,w,h,d,mat,parent=scene){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function cyl(x,y,z,rt,rb,h,mat,parent=scene,seg=14){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg), mat);
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
function wall(x, z, w, d, h=2.75, tex=M.wallBase, color=0xffffff){
  const mat = matFrom(tex, Math.max(w,d), h, color);
  const m = box(x, h/2, z, w, h, d, mat);
  addCollider(x, z, w, d, 'wall');
  // baseboards on both long faces
  const trimMat = new THREE.MeshStandardMaterial({ color:COL.trim, roughness:0.7 });
  if (w > d + 0.05) {
    box(x, 0.07, z - d/2 - 0.02, w, 0.14, 0.035, trimMat);
    box(x, 0.07, z + d/2 + 0.02, w, 0.14, 0.035, trimMat);
  } else if (d > w + 0.05) {
    box(x - w/2 - 0.02, 0.07, z, 0.035, 0.14, d, trimMat);
    box(x + w/2 + 0.02, 0.07, z, 0.035, 0.14, d, trimMat);
  }
  return m;
}

// ============================================================
//  THE APARTMENT
//  bedroom[-8,-3]x[-6,-1] | bath[-8,-5]x[-1,1.5] | living[-3,3.5]x[-6,1.5]
//  kitchen[3.5,8]x[-6,1.5] | hall[-8,8]x[1.5,3.5] | study[3.5,8]x[3.5,6]
//  copy living[-3,3.5]x[3.5,6]
// ============================================================

// ---- shell ----
const floorMat = matFrom(woodFloor, 20, 16, 0xffffff, {roughness:0.62});
const shell = box(0, -0.06, 0, 16.4, 0.12, 12.4, floorMat);
shell.receiveShadow = true;
box(0, 2.79, 0, 16.4, 0.1, 12.4, matFrom(ceilingTex, 16, 12, 0xffffff, {roughness:1}));

// outer walls
wall(0, -6.15, 16.4, 0.3);
wall(0, 6.15, 16.4, 0.3);
wall(-8.15, 0, 0.3, 12.3);
wall(8.15, 0, 0.3, 12.3);

// bedroom east wall x=-3, door gap z[-4.35,-3.15]
wall(-3, -5.2, 0.22, 1.9);
wall(-3, -2.13, 0.22, 2.26);
// bedroom south wall z=-1
wall(-5.5, -1, 5.0, 0.22);
// bathroom east wall x=-5
wall(-5, 0.25, 0.22, 2.5);
// hall north wall z=1.5 (openings: bath door, living arch, kitchen door)
wall(-7.3, 1.5, 1.4, 0.22);
wall(-3.8, 1.5, 3.2, 0.22);
wall(3.3, 1.5, 4.2, 0.22);
wall(7.3, 1.5, 1.4, 0.22);
// living / kitchen divider x=3.5, gap z[-2.6,-1.3]
wall(3.5, -4.3, 0.22, 3.4);
wall(3.5, -0.15, 0.22, 2.3);
// hall south wall z=3.5 (openings: hidden door, study door)
wall(-4.4, 3.5, 6.4, 0.22);
wall(3.15, 3.5, 4.5, 0.22);
wall(7.3, 3.5, 1.4, 0.22);
// study west wall x=3.5 (z 3.5..6)
wall(3.5, 4.85, 0.22, 2.3);
// copy room west wall x=-3 (z 3.5..6)
wall(-3, 4.85, 0.22, 2.3);

// hidden wall segment in hallway south (becomes doorway later)
const hiddenWallMesh = box(-0.15, 1.375, 3.5, 2.15, 2.75, 0.2, matFrom(wallpaper, 2, 2.75));
const hiddenCol = { x1:-1.22, x2:0.92, z1:3.4, z2:3.6, tag:'hiddenWall' };
colliders.push(hiddenCol);

// ---------------- WINDOWS ----------------
function addWindow(x, z, w=1.5, h=1.35, rotY=0){
  const g = new THREE.Group(); g.position.set(x, 1.62, z); g.rotation.y = rotY; scene.add(g);
  const frameMat = new THREE.MeshStandardMaterial({ color:0x2a2521, roughness:0.55, metalness:0.05 });
  // night view backdrop
  const view = new THREE.Mesh(new THREE.PlaneGeometry(w-0.04, h-0.04),
    new THREE.MeshBasicMaterial({ map: windowView.clone(), toneMapped:false, color:0xdce8ff }));
  view.position.z = 0.022; g.add(view);
  // glass sheen
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color:0x1b2a3e, roughness:0.12, metalness:0.3, transparent:true, opacity:0.22 }));
  glass.position.z = 0.062; g.add(glass);
  // frame
  const bar = (bx,by,bw,bh) => box(bx,by,0.105,bw,bh,0.1,frameMat,g);
  bar(0,  h/2, w+0.16, 0.09); bar(0, -h/2, w+0.16, 0.09);
  bar(-w/2, 0, 0.09, h); bar(w/2, 0, 0.09, h);
  bar(0, 0, 0.055, h); bar(0, 0, w+0.1, 0.055);
  // sill
  const sill = box(0, -h/2-0.1, 0.16, w+0.34, 0.09, 0.3, frameMat, g);
  sill.receiveShadow = true;
  // curtains: soft folds, hung from the rod
  const curtCol = new THREE.MeshStandardMaterial({ color:0x7b7062, roughness:1, side:THREE.DoubleSide });
  for (const sx of [-1,1]){
    const panel = new THREE.Group();
    panel.position.set(sx*(w/2+0.27), 0, 0.22);
    g.add(panel);
    for (let f=0; f<3; f++){
      const c = box((f-1)*0.105, 0.02, f*0.022, 0.135, h+0.42, 0.055, curtCol, panel);
      c.rotation.z = sx*0.012*(f-1);
    }
    // tie-back
    const tie = box(0, -h*0.12, 0.05, 0.36, 0.07, 0.075,
      new THREE.MeshStandardMaterial({ color:0x4a3f34, roughness:0.9 }), panel);
    tie.rotation.z = sx*0.06;
  }
  // curtain rod
  const rod = cyl(0, h/2+0.44, 0.2, 0.018, 0.018, w+0.9, new THREE.MeshStandardMaterial({color:0x3a332c, metalness:0.6, roughness:0.4}), g, 8);
  rod.rotation.z = Math.PI/2;
  // cool spill
  const sp = new THREE.PointLight(0x7c9fd4, 2.3, 5.6, 2);
  sp.position.set(0, 0.1, 0.75); g.add(sp);
  return g;
}
const bedMoon = new THREE.SpotLight(0x9db8e6, 2.6, 7.0, 0.7, 0.65, 1.4);
bedMoon.position.set(-6.7, 2.4, -5.7);
bedMoon.target.position.set(-6.3, 0.5, -3.6);
scene.add(bedMoon); scene.add(bedMoon.target);
addWindow(-6.7, -5.98, 1.55, 1.3);
addWindow(2.15, -5.98, 1.5, 1.25);

// ---------------- DOORS ----------------
const doors = [];
function makeDoor({ id, x, z, axis='x', w=0.98, label='Door', hinge=1, locked=false, color=0x4a3524 }){
  const g = new THREE.Group(); g.position.set(x,0,z);
  if (axis === 'z') g.rotation.y = Math.PI/2;
  scene.add(g);
  const woodMat = new THREE.MeshStandardMaterial({ color, roughness:0.72, metalness:0.02 });
  const frameMat = new THREE.MeshStandardMaterial({ color:0x241d16, roughness:0.6 });
  const H = 2.12;
  // frame (local X spans doorway, Z is wall normal)
  box(-w/2-0.05, H/2, 0, 0.1, H+0.08, 0.3, frameMat, g);
  box( w/2+0.05, H/2, 0, 0.1, H+0.08, 0.3, frameMat, g);
  box(0, H+0.04, 0, w+0.22, 0.11, 0.3, frameMat, g);
  // leaf pivot
  const pivot = new THREE.Group(); pivot.position.x = hinge*w/2; g.add(pivot);
  const leaf = box(-hinge*w/2, H/2, 0, w-0.03, H-0.02, 0.055, woodMat, pivot);
  // panels
  const panelMat = new THREE.MeshStandardMaterial({ color:0x3b2a1c, roughness:0.75 });
  box(-hinge*w/2, H*0.72, 0.035, w*0.62, H*0.34, 0.012, panelMat, pivot);
  box(-hinge*w/2, H*0.32, 0.035, w*0.62, H*0.34, 0.012, panelMat, pivot);
  // handle
  const brass = new THREE.MeshStandardMaterial({ color:0xb08d4f, metalness:0.85, roughness:0.3 });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), brass);
  knob.position.set(-hinge*(w-0.16), 1.02, 0.07); pivot.add(knob);
  leaf.userData = { interact:true, id, label, door:null };
  knob.userData = { interact:true, id, label, door:null };
  const col = axis==='x'
    ? { x1:x-w/2, x2:x+w/2, z1:z-0.16, z2:z+0.16, tag:'door' }
    : { x1:x-0.16, x2:x+0.16, z1:z-w/2, z2:z+w/2, tag:'door' };
  colliders.push(col);
  const door = { id, axis, width:w, pivot, g, open:false, col, closedRot:0, openRot:hinge*1.75, leaf, locked, label };
  leaf.userData.door = door; knob.userData.door = door;
  doors.push(door);
  return door;
}
makeDoor({ id:'bedroomDoor', x:-3, z:-3.75, axis:'z', label:'Bedroom door' });
makeDoor({ id:'bathDoor',    x:-6.0, z:1.5, axis:'x', label:'Bathroom door' });
makeDoor({ id:'kitchenDoor', x:6.0, z:1.5, axis:'x', label:'Kitchen door' });
makeDoor({ id:'studyDoor',   x:6.0, z:3.5, axis:'x', label:'Study door' });
makeDoor({ id:'copyDoor',    x:-0.15, z:3.5, axis:'x', w:1.85, label:'The other living room' });
doors.find(d=>d.id==='copyDoor').g.visible = false;
doors.find(d=>d.id==='copyDoor').col.x1 = -99; doors.find(d=>d.id==='copyDoor').col.x2 = -98;

// ---------------- FRONT DOOR ----------------
const frontG = new THREE.Group(); frontG.position.set(8.02, 0, 2.4); frontG.rotation.y = -Math.PI/2; scene.add(frontG);
{
  const steel = new THREE.MeshStandardMaterial({ color:0x3d4148, roughness:0.52, metalness:0.5 });
  const frameMat = new THREE.MeshStandardMaterial({ color:0x26262a, roughness:0.5, metalness:0.3 });
  box(0, 1.06, 0, 1.02, 2.12, 0.09, steel, frontG).userData = { interact:true, id:'frontDoor', label:'Front door — locked' };
  box(-0.56, 1.06, 0, 0.12, 2.2, 0.16, frameMat, frontG);
  box( 0.56, 1.06, 0, 0.12, 2.2, 0.16, frameMat, frontG);
  box(0, 2.17, 0, 1.24, 0.12, 0.16, frameMat, frontG);
  // deadbolt + panel
  box(0.3, 1.05, 0.07, 0.16, 0.24, 0.05, new THREE.MeshStandardMaterial({color:0x9aa0a6, metalness:0.9, roughness:0.25}), frontG);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshBasicMaterial({ color:0x7a1010 }));
  led.position.set(0.3, 1.14, 0.1); frontG.add(led);
  box(-0.32, 1.02, 0.07, 0.3, 0.05, 0.05, new THREE.MeshStandardMaterial({color:0xb08d4f, metalness:0.8, roughness:0.3}), frontG);
  // peephole
  const peep = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), new THREE.MeshStandardMaterial({color:0x111, metalness:1, roughness:0.1}));
  peep.position.set(0, 1.55, 0.05); frontG.add(peep);
  addCollider(8.05, 2.4, 0.4, 1.2, 'frontDoor');
}

// ---------------- FURNITURE BUILDERS ----------------
function makeBed(x, z){
  const g = new THREE.Group(); g.position.set(x,0,z); scene.add(g);
  const wood = new THREE.MeshStandardMaterial({ color:0x3a2a1d, roughness:0.75 });
  const sheet = new THREE.MeshStandardMaterial({ map:matFrom(fabricWeave,2,2,0x8f949c).map, color:0x8f949c, roughness:1 });
  const duvet = new THREE.MeshStandardMaterial({ map:matFrom(fabricWeave,2,2,0x3c4350).map, color:0x3c4350, roughness:1 });
  box(0, 0.18, 0, 2.0, 0.26, 2.2, wood, g);
  box(-0.98, 0.62, 0, 0.1, 1.1, 2.24, wood, g); // headboard
  const mattress = box(0, 0.4, 0, 1.9, 0.28, 2.08, sheet, g);
  const d = box(0, 0.56, 0.18, 1.88, 0.14, 1.55, duvet, g);
  d.castShadow = true;
  // pillows
  const pmat = new THREE.MeshStandardMaterial({ map:matFrom(fabricWeave,1,1,0xd8d3c8).map, color:0xd8d3c8, roughness:1 });
  for (const pz of [-0.62, 0.62]) {
    const p = box(-0.62, 0.62, pz, 0.62, 0.16, 0.42, pmat, g); p.rotation.z = 0.02;
  }
  addCollider(x-0.2, z, 1.7, 2.0, 'bed');
  return g;
}
function makeSofa(x, z, rot=0, color=COL.fabricA){
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = rot; scene.add(g);
  const fm = new THREE.MeshStandardMaterial({ map:matFrom(fabricWeave,2,2,color).map, color, roughness:1 });
  const cush = new THREE.MeshStandardMaterial({ map:matFrom(fabricWeave,2,2,color).map, color:new THREE.Color(color).offsetHSL(0,0,0.05), roughness:1 });
  box(0, 0.26, 0, 2.55, 0.36, 0.92, fm, g);
  box(0, 0.72, -0.4, 2.55, 0.62, 0.18, fm, g);
  box(-1.24, 0.54, 0, 0.14, 0.56, 0.92, fm, g);
  box( 1.24, 0.54, 0, 0.14, 0.56, 0.92, fm, g);
  for (const dx of [-0.78, 0, 0.78]) {
    const c = box(dx, 0.53, 0.04, 0.74, 0.2, 0.76, cush, g);
    c.rotation.x = -0.03;
  }
  // legs
  const leg = new THREE.MeshStandardMaterial({ color:0x2a1f16, roughness:0.7 });
  for (const [lx,lz] of [[-1.15,-0.35],[1.15,-0.35],[-1.15,0.35],[1.15,0.35]]) cyl(lx,0.08,lz,0.03,0.04,0.16,leg,g,8);
  // throw blanket
  box(0.75, 0.62, 0.1, 0.55, 0.06, 0.8, new THREE.MeshStandardMaterial({color:0x6a5d4c, roughness:1}), g);
  const throwBack = box(0.15, 0.86, -0.505, 1.0, 0.42, 0.045, new THREE.MeshStandardMaterial({color:0x4f453a, roughness:1}), g);
  throwBack.rotation.z = 0.03;
  addCollider(x, z, 2.6, 0.95, 'sofa');
  return g;
}
function makeTable(x, z, w=1.4, d=0.72, h=0.44){
  const g = new THREE.Group(); g.position.set(x,0,z); scene.add(g);
  const wood = new THREE.MeshStandardMaterial({ color:0x3b2a1d, roughness:0.6 });
  box(0, h, 0, w, 0.06, d, wood, g);
  const leg = new THREE.MeshStandardMaterial({ color:0x2a1d13, roughness:0.7 });
  for (const [lx,lz] of [[-w/2+0.08,-d/2+0.08],[w/2-0.08,-d/2+0.08],[-w/2+0.08,d/2-0.08],[w/2-0.08,d/2-0.08]]) cyl(lx,h/2,lz,0.035,0.035,h,leg,g,8);
  addCollider(x, z, w, d, 'table');
  return g;
}
function makeRug(x, z, w, d, rot=0){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d), new THREE.MeshStandardMaterial({ map:matFrom(rugTex,w/2,d/2).map, roughness:1 }));
  m.rotation.x = -Math.PI/2; m.rotation.z = rot;
  m.position.set(x, 0.008, z); m.receiveShadow = true; scene.add(m); return m;
}
function makeLamp(x, z, h=1.55, warm=0xffb26b, intensity=9){
  const g = new THREE.Group(); g.position.set(x,0,z); scene.add(g);
  const metal = new THREE.MeshStandardMaterial({ color:0x2a2a2c, metalness:0.7, roughness:0.35 });
  cyl(0,0.03,0,0.16,0.18,0.05,metal,g,14);
  cyl(0,h/2,0,0.014,0.014,h,metal,g,8);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.22,0.26,18,1,true),
    new THREE.MeshStandardMaterial({ color:0xcbb99a, roughness:0.95, side:THREE.DoubleSide, emissive:0x2a1c0c, emissiveIntensity:0.22 }));
  shade.position.y = h; g.add(shade);
  const bulb = new THREE.PointLight(warm, intensity, 6.5, 2);
  bulb.position.y = h - 0.06; g.add(bulb);
  const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.035,10,8), new THREE.MeshBasicMaterial({ color:0xffe6bd }));
  bulbMesh.position.y = h - 0.2; g.add(bulbMesh);
  return bulb;
}
function makeCeilingLamp(x, z, color=0xffd9a8, intensity=5){
  const g = new THREE.Group(); g.position.set(x, 2.55, z); scene.add(g);
  const metal = new THREE.MeshStandardMaterial({ color:0x232326, metalness:0.6, roughness:0.4 });
  cyl(0, 0.16, 0, 0.13, 0.15, 0.06, metal, g, 16);
  cyl(0, 0.09, 0, 0.07, 0.09, 0.1, metal, g, 12);
  const shade = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 12, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshStandardMaterial({ color:0xe0d4bc, roughness:0.95, side:THREE.DoubleSide, emissive:0x3a2a14, emissiveIntensity:0.35 }));
  shade.rotation.x = Math.PI; shade.position.y = 0.02; g.add(shade);
  const l = new THREE.PointLight(color, intensity*0.6, 6.2, 2); l.position.y = -0.34; g.add(l);
  return l;
}
function makeShelf(x, z, w, d, h, rot=0){
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = rot; scene.add(g);
  const wood = new THREE.MeshStandardMaterial({ color:0x352619, roughness:0.8 });
  box(0, h/2, -d/2+0.01, w, h, 0.05, wood, g);
  box(-w/2+0.025, h/2, 0, 0.05, h, d, wood, g);
  box( w/2-0.025, h/2, 0, 0.05, h, d, wood, g);
  box(0, h-0.025, 0, w, 0.05, d, wood, g);
  const bookCols = [0x5c2a2a,0x2e4256,0x4a4a2e,0x3e2c46,0x5a4a2a,0x243c34];
  for (let s=0; s<4; s++){
    const y = 0.35 + s*(h-0.4)/4;
    box(0, y, 0, w-0.1, 0.04, d-0.05, wood, g);
    let bx = -w/2+0.12;
    while (bx < w/2-0.15) {
      const bw = 0.03+Math.random()*0.05, bh = 0.18+Math.random()*0.1;
      const b = box(bx+bw/2, y+bh/2+0.02, 0, bw, bh, d*0.62,
        new THREE.MeshStandardMaterial({ color:bookCols[(Math.random()*bookCols.length)|0], roughness:0.9 }), g);
      b.rotation.z = (Math.random()-0.5)*0.05;
      bx += bw + 0.006;
    }
  }
  const rw = Math.abs(Math.sin(rot))>0.7 ? d : w;
  const rd = Math.abs(Math.sin(rot))>0.7 ? w : d;
  addCollider(x, z, rw, rd, 'shelf');
  return g;
}

// ============================================================
//  FURNISHING
// ============================================================
const actions = {};
function reg(obj, id, label, fn){
  obj.userData = { ...(obj.userData||{}), interact:true, id, label };
  if (fn) actions[id] = fn;
  return obj;
}

// ---------- BEDROOM ----------
makeBed(-6.7, -3.9);
makeRug(-5.5, -3.2, 2.8, 2.1);
const nightstandMat = new THREE.MeshStandardMaterial({ color:0x362619, roughness:0.75 });
box(-5.3, 0.28, -5.3, 0.52, 0.56, 0.45, nightstandMat);
box(-5.3, 0.58, -5.3, 0.56, 0.04, 0.49, nightstandMat);
{
  // small table lamp on the nightstand
  const g = new THREE.Group(); g.position.set(-5.3, 0.58, -5.36); scene.add(g);
  const metal = new THREE.MeshStandardMaterial({ color:0x3a3632, metalness:0.6, roughness:0.4 });
  cyl(0,0.02,0,0.13,0.15,0.04,metal,g,14);
  cyl(0,0.18,0,0.012,0.012,0.32,metal,g,8);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.19,0.22,18,1,true),
    new THREE.MeshStandardMaterial({ color:0xd8c6a4, roughness:0.95, side:THREE.DoubleSide, emissive:0x3a2814, emissiveIntensity:0.5 }));
  shade.position.y = 0.38; g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.032,10,8), new THREE.MeshBasicMaterial({ color:0xffe6bd }));
  bulb.position.y = 0.34; g.add(bulb);
  const l = new THREE.PointLight(0xffb877, 5.5, 6.0, 2); l.position.y = 0.34; g.add(l);
}
// dresser
const dresserMat = new THREE.MeshStandardMaterial({ color:0x3d2b1d, roughness:0.7 });
box(-4.35, 0.47, -5.72, 1.55, 0.94, 0.5, dresserMat);
for (let i=0;i<3;i++){
  box(-4.35, 0.22+i*0.27, -5.45, 1.4, 0.22, 0.04, new THREE.MeshStandardMaterial({color:0x453121, roughness:0.7}));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022,8,6), new THREE.MeshStandardMaterial({color:0xb08d4f, metalness:0.8, roughness:0.3}));
  knob.position.set(-4.35, 0.22+i*0.27, -5.42); scene.add(knob);
}
// closet (hide spot)
const closetMat = new THREE.MeshStandardMaterial({ color:0x33251a, roughness:0.8 });
box(-3.42, 1.05, -5.35, 0.5, 2.1, 1.15, closetMat);
box(-3.16, 1.05, -5.35, 0.03, 2.0, 1.03, new THREE.MeshStandardMaterial({color:0x2a1e15, roughness:0.8}));
addCollider(-3.42, -5.35, 0.5, 1.15, 'closet');
// wall photos (bedroom)
function photoCanvas(variant){
  return canvasTex(256, 320, (x,w,h)=>{
    if (variant === 0) {
      x.fillStyle='#1a1712'; x.fillRect(0,0,w,h);
      const g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,'#4a4038'); g.addColorStop(1,'#221d18');
      x.fillStyle=g; x.fillRect(12,12,w-24,h-24);
      // three silhouettes
      x.fillStyle='#0c0a08';
      for (const [cx,cy,s] of [[70,190,1],[128,175,1.15],[186,195,0.95]]) {
        x.beginPath(); x.arc(cx, cy-60*s, 22*s, 0, 7); x.fill();
        x.beginPath(); x.ellipse(cx, cy+10*s, 30*s, 52*s, 0, 0, 7); x.fill();
      }
      x.fillStyle='#8a7a64'; x.font='16px serif'; x.fillText('1998', 20, 300);
    } else {
      x.fillStyle='#141210'; x.fillRect(0,0,w,h);
      const g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,'#332b24'); g.addColorStop(1,'#161310');
      x.fillStyle=g; x.fillRect(12,12,w-24,h-24);
      // only one silhouette, facing away
      x.fillStyle='#070605';
      x.beginPath(); x.arc(128, 130, 26, 0, 7); x.fill();
      x.beginPath(); x.ellipse(128, 250, 40, 78, 0, 0, 7); x.fill();
      x.fillStyle='#6a5a48'; x.font='14px serif'; x.fillText('tomorrow', 20, 300);
    }
    x.strokeStyle='#5a4a38'; x.lineWidth=4; x.strokeRect(6,6,w-12,h-12);
  });
}
const photoTexA = photoCanvas(0), photoTexB = photoCanvas(1);
const photos = [];
function addPhoto(x, z, rotY, w=0.5, h=0.64){
  const frame = new THREE.Group(); frame.position.set(x,1.58,z); frame.rotation.y = rotY; scene.add(frame);
  box(0,0,0.01,w+0.07,h+0.07,0.03,new THREE.MeshStandardMaterial({color:0x2b2118, roughness:0.6}),frame);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshStandardMaterial({ map:photoTexA.clone(), roughness:0.85 }));
  m.position.z = 0.03; m.userData = { interact:true, id:'photo', label:'Photograph — look closer' };
  frame.add(m); photos.push(m);
  return m;
}
addPhoto(-3.0+0.12, -5.0, Math.PI/2);
addPhoto(-3.0+0.12, -2.6, Math.PI/2, 0.42, 0.54);

// flashlight on dresser
const torchMat = new THREE.MeshStandardMaterial({ color:0x1b1b1d, metalness:0.7, roughness:0.35 });
const torch = new THREE.Group(); torch.position.set(-4.75, 0.98, -5.66); scene.add(torch);
cyl(0,0,0,0.035,0.045,0.2,torchMat,torch,12).rotation.z = Math.PI/2;
const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038,14), new THREE.MeshBasicMaterial({color:0xffe6b0}));
lens.position.set(0.101,0,0); lens.rotation.y = Math.PI/2; torch.add(lens);
reg(torch, 'torch', 'Take the flashlight', ()=>{});
torch.traverse(o=>{ o.userData.interact = true; o.userData.id = 'torch'; o.userData.label = 'Take the flashlight'; });

// diary
const diary = box(-4.05, 1.0, -5.6, 0.24, 0.05, 0.32, new THREE.MeshStandardMaterial({ color:0x4a1414, roughness:0.8 }));
reg(diary, 'diary', 'Read the diary', ()=>{});
// phone
const phoneObj = box(-5.34, 0.6, -5.34, 0.09, 0.015, 0.17, new THREE.MeshStandardMaterial({ color:0x0a0a0c, metalness:0.4, roughness:0.3, emissive:0x0a0f1a, emissiveIntensity:0.6 }));
phoneObj.rotation.y = 0.3;
reg(phoneObj, 'phoneObj', 'Look at your phone', ()=>{});
// note
const note = box(-4.55, 1.0, -5.55, 0.2, 0.005, 0.26, new THREE.MeshStandardMaterial({ color:0xd8d2c4, roughness:1 }));
note.rotation.y = -0.15; reg(note, 'note1', 'Read the note', ()=>{});

// ---------- LIVING ROOM ----------
const consoleMat = new THREE.MeshStandardMaterial({ color:0x2f2318, roughness:0.7 });
box(-0.6, 0.24, -5.62, 2.2, 0.48, 0.5, consoleMat);
box(-0.6, 0.5, -5.62, 2.24, 0.04, 0.52, consoleMat);

// TV
const tvRT = new THREE.WebGLRenderTarget(640, 360, { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter });
const tvCam = new THREE.PerspectiveCamera(58, 16/9, 0.1, 30);
const tvOffTex = canvasTex(256,144,(x,w,h)=>{
  const g=x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,'#0a0c10'); g.addColorStop(0.45,'#12161c'); g.addColorStop(1,'#070809');
  x.fillStyle=g; x.fillRect(0,0,w,h);
  const s=x.createLinearGradient(0,h,0,0);
  s.addColorStop(0,'rgba(120,145,180,0.10)'); s.addColorStop(1,'rgba(120,145,180,0)');
  x.fillStyle=s; x.fillRect(0,0,w,h);
});
const tvScreenMat = new THREE.MeshBasicMaterial({ map: tvOffTex });
function buildTV(x, z, rotY){
  const g = new THREE.Group(); g.position.set(x, 1.32, z); g.rotation.y = rotY; scene.add(g);
  const bezel = new THREE.MeshStandardMaterial({ color:0x141416, roughness:0.4, metalness:0.3 });
  box(0,0,-0.045,1.62,0.94,0.09,bezel,g);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.46,0.8), tvScreenMat);
  screen.position.z = 0.005; g.add(screen);
  const stand = new THREE.MeshStandardMaterial({ color:0x1a1a1c, metalness:0.5, roughness:0.4 });
  box(0,-0.5,0.02,0.5,0.06,0.22,stand,g);
  cyl(0,-0.24,0.02,0.02,0.02,0.2,stand,g,8);
  return { g, screen };
}
const tvMain = buildTV(-0.6, -5.72, 0);
tvMain.screen.userData = { interact:true, id:'tv', label:'Television' };
const tvCopy = buildTV(-0.6, 5.72, Math.PI);
{
  const cm = new THREE.MeshStandardMaterial({ color:0x3a2c20, roughness:0.7 });
  box(-0.6, 0.24, 5.85, 2.15, 0.48, 0.4, cm);
  box(-0.6, 0.5, 5.85, 2.2, 0.04, 0.42, cm);
}
tvCopy.screen.userData = { interact:true, id:'tv', label:'Television' };
tvCopy.g.visible = false;

makeSofa(-0.6, -3.15, Math.PI, COL.fabricA);
makeTable(-0.6, -4.35, 1.5, 0.68, 0.44);
makeRug(-0.6, -4.15, 3.4, 2.4);
makeSofa(1.55, -2.85, -0.55, 0x9a8578);
makeLamp(-2.4, -2.3, 1.5, 0xffb877, 9.0);
{
  makeLamp(2.05, -2.25, 1.5, 0xffb877, 7.0);
  const tvFill = new THREE.PointLight(0xffd0a2, 3.4, 7.5, 2);
  tvFill.position.set(2.5, 1.55, -2.1); scene.add(tvFill);
  const sofaBackFill = new THREE.PointLight(0xffd7b0, 4.2, 4.2, 2);
  sofaBackFill.position.set(-0.5, 1.75, -1.5); scene.add(sofaBackFill);
  const sofaKey = new THREE.SpotLight(0xffd9b4, 16, 7, 0.7, 1.0, 1.4);
  sofaKey.position.set(-0.6, 2.3, -1.1);
  sofaKey.target.position.set(-0.6, 0.8, -2.9);
  scene.add(sofaKey); scene.add(sofaKey.target);
}
makeShelf(3.22, -4.55, 1.8, 0.34, 2.0, -Math.PI/2);
// plant
{
  const g=new THREE.Group(); g.position.set(-2.5,0,-5.45); scene.add(g);
  cyl(0,0.16,0,0.16,0.13,0.32,new THREE.MeshStandardMaterial({color:0x4a3a2c, roughness:0.9}),g,12);
  const leafMat=new THREE.MeshStandardMaterial({color:0x2a4a30, roughness:0.9, side:THREE.DoubleSide});
  for(let i=0;i<9;i++){
    const l=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.5,6),leafMat);
    l.position.set((Math.random()-0.5)*0.2,0.45+Math.random()*0.4,(Math.random()-0.5)*0.2);
    l.rotation.set((Math.random()-0.5)*0.8, Math.random()*6, (Math.random()-0.5)*0.8); g.add(l);
  }
  addCollider(-2.5,-5.45,0.4,0.4,'plant');
}
// tape on console
const tape = box(0.36, 0.55, -5.6, 0.19, 0.03, 0.11, new THREE.MeshStandardMaterial({ color:0x101012, roughness:0.6 }));
reg(tape, 'tape', 'Take the VHS tape', ()=>{});
// note on coffee table
const note2 = box(-0.2, 0.47, -4.3, 0.2, 0.006, 0.26, new THREE.MeshStandardMaterial({ color:0xd8d2c4, roughness:1 }));
note2.rotation.y = 0.4; reg(note2, 'note2', 'Read the note', ()=>{});

// ---------- KITCHEN ----------
const counterMat = new THREE.MeshStandardMaterial({ color:0x4a4d50, roughness:0.55, metalness:0.1 });
const cabinetMat = new THREE.MeshStandardMaterial({ color:0x4c4b47, roughness:0.66 });
const stoneMat = new THREE.MeshStandardMaterial({ color:0x74777a, roughness:0.32, metalness:0.08 });
box(5.9, 0.44, -5.55, 3.5, 0.88, 0.68, cabinetMat);
addCollider(5.9, -5.55, 3.5, 0.7, 'counter');
box(5.9, 0.9, -5.55, 3.56, 0.05, 0.72, stoneMat);
// cabinet doors
for (let i=0;i<5;i++){
  box(4.35+i*0.65, 0.42, -5.2, 0.6, 0.72, 0.03, new THREE.MeshStandardMaterial({color:0x5b5a55, roughness:0.66}));
}
// upper cabinets
box(5.9, 1.9, -5.72, 3.5, 0.66, 0.34, cabinetMat);
for (let i=0;i<3;i++) box(4.55+i*1.1, 1.9, -5.54, 1.02, 0.6, 0.03, new THREE.MeshStandardMaterial({color:0x5b5a55, roughness:0.66}));
// sink
box(5.15, 0.905, -5.55, 0.7, 0.03, 0.44, new THREE.MeshStandardMaterial({color:0x8a8f94, metalness:0.85, roughness:0.25}));
cyl(5.15, 1.08, -5.7, 0.018, 0.018, 0.34, new THREE.MeshStandardMaterial({color:0xb0b4b8, metalness:0.9, roughness:0.2}), scene, 8);
// fridge
{
  const g=new THREE.Group(); g.position.set(7.5,0,-5.25); scene.add(g);
  const st=new THREE.MeshStandardMaterial({color:0x9aa0a6, metalness:0.65, roughness:0.35});
  box(0,0.98,0,0.82,1.96,0.72,st,g);
  box(0,1.3,0.37,0.78,0.02,0.02,new THREE.MeshStandardMaterial({color:0x2a2a2c}),g);
  box(0.28,1.1,0.37,0.03,0.5,0.03,new THREE.MeshStandardMaterial({color:0x2a2a2c, metalness:0.7}),g);
  addCollider(7.5,-5.25,0.86,0.76,'fridge');
}
// key drawer
const keyDrawer = box(6.5, 0.72, -5.19, 0.55, 0.18, 0.04, new THREE.MeshStandardMaterial({ color:0x3d3b38, roughness:0.7 }));
reg(keyDrawer, 'key', 'Open the kitchen drawer', ()=>{});
// under-cabinet glow
{
  const l = new THREE.PointLight(0xffd9a0, 2.2, 3.0, 2); l.position.set(5.9, 1.52, -5.35); scene.add(l);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(3.3,0.05), new THREE.MeshBasicMaterial({color:0xffe0b0}));
  strip.position.set(5.9,1.56,-5.5); strip.rotation.x = Math.PI/2; scene.add(strip);
}
// kitchen window (east wall)
addWindow(7.98, -3.2, 1.2, 1.05, -Math.PI/2);
// small table + two chairs
makeTable(5.2, -2.2, 1.1, 0.75, 0.74);
addCollider(5.2, -2.2, 1.1, 0.75, 'kitchenTable');
for (const [cx,cz,rot] of [[4.5,-2.2,Math.PI/2],[5.9,-2.2,-Math.PI/2]]) {
  const g=new THREE.Group(); g.position.set(cx,0,cz); g.rotation.y=rot; scene.add(g);
  const ch=new THREE.MeshStandardMaterial({color:0x342a22, roughness:0.8});
  box(0,0.45,0,0.42,0.05,0.42,ch,g);
  box(0,0.7,-0.2,0.42,0.5,0.04,ch,g);
  for(const [lx,lz] of [[-0.18,-0.18],[0.18,-0.18],[-0.18,0.18],[0.18,0.18]]) cyl(lx,0.22,lz,0.02,0.02,0.44,ch,g,6);
}
// mug
cyl(5.0, 0.4, -4.9, 0.04, 0.035, 0.09, new THREE.MeshStandardMaterial({color:0x8a7f72, roughness:0.5}), scene, 12);

// ---------- BATHROOM ----------
{
  const tg = new THREE.Group(); tg.position.set(-6.5, 0.012, 0.25); scene.add(tg);
  const tileMat = new THREE.MeshStandardMaterial({ map: matFrom(tiles,3,2.5).map, roughness:0.4 });
  const tf = new THREE.Mesh(new THREE.PlaneGeometry(3.0,2.5), tileMat); tf.rotation.x=-Math.PI/2; tg.add(tf);
  // tub
  const porcelain = new THREE.MeshStandardMaterial({ color:0xd8d6d0, roughness:0.25, metalness:0.05 });
  box(-6.55, 0.28, -0.7, 2.5, 0.55, 0.78, porcelain);
  box(-6.55, 0.5, -0.7, 2.3, 0.08, 0.6, new THREE.MeshStandardMaterial({color:0xbfbdb7, roughness:0.3}));
  // sink
  box(-7.6, 0.42, 0.55, 0.5, 0.84, 0.8, new THREE.MeshStandardMaterial({color:0x4b3f33, roughness:0.75}));
  // vanity doors + handles
  box(-7.34, 0.42, 0.57, 0.02, 0.7, 0.72, new THREE.MeshStandardMaterial({color:0x3c3229, roughness:0.8}));
  box(-7.32, 0.6, 0.36, 0.015, 0.02, 0.06, new THREE.MeshStandardMaterial({color:0x8a7a5a, metalness:0.4, roughness:0.4}));
  box(-7.32, 0.6, 0.78, 0.015, 0.02, 0.06, new THREE.MeshStandardMaterial({color:0x8a7a5a, metalness:0.4, roughness:0.4}));
  box(-7.6, 0.86, 0.55, 0.54, 0.05, 0.84, porcelain);
  // vessel basin
  box(-7.6, 0.92, 0.55, 0.46, 0.12, 0.36, porcelain);
  box(-7.6, 0.982, 0.55, 0.38, 0.006, 0.28, new THREE.MeshStandardMaterial({ color:0x9aa0a4, roughness:0.25, metalness:0.1 }));
  // faucet with base + spout (behind the basin, against the mirror)
  const chrome = new THREE.MeshStandardMaterial({ color:0xc6cace, metalness:0.45, roughness:0.3 });
  cyl(-7.85, 0.99, 0.55, 0.035, 0.04, 0.06, chrome, scene, 12);
  cyl(-7.85, 1.07, 0.55, 0.016, 0.016, 0.18, chrome, scene, 10);
  const spout = cyl(-7.79, 1.155, 0.55, 0.014, 0.014, 0.16, chrome, scene, 10);
  spout.rotation.z = Math.PI/2;
  // towel rail
  box(-7.9, 1.42, 0.95, 0.03, 0.03, 0.5, chrome);
  box(-7.9, 1.18, 0.95, 0.035, 0.46, 0.28, new THREE.MeshStandardMaterial({color:0x8a8478, roughness:1}));
  // bath mat
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.6), new THREE.MeshStandardMaterial({color:0x555f66, roughness:1}));
  mat.rotation.x=-Math.PI/2; mat.position.set(-6.5,0.02,0.15); mat.receiveShadow=true; scene.add(mat);
  cyl(-7.55, 1.02, 0.35, 0.015, 0.015, 0.2, new THREE.MeshStandardMaterial({color:0xb0b4b8, metalness:0.9, roughness:0.15}), scene, 8);
  // toilet
  const wc = new THREE.Group(); wc.position.set(-5.55, 0, -0.3); wc.rotation.y = -Math.PI/2; scene.add(wc);
  box(0,0.2,0,0.42,0.4,0.6,porcelain,wc);
  box(0,0.42,0.16,0.44,0.06,0.5,porcelain,wc);
  box(0,0.62,-0.24,0.44,0.42,0.16,porcelain,wc);
  addCollider(-6.5,-0.7,2.6,0.9,'tub');
  addCollider(-5.6,-0.3,0.5,0.7,'toilet');
}
// mirror (real reflection)
let mirrorMesh = null;
const mirrorGroup = new THREE.Group(); mirrorGroup.position.set(-7.96, 1.52, 0.55); mirrorGroup.rotation.y = Math.PI/2; scene.add(mirrorGroup);
{
  const giltMat = new THREE.MeshStandardMaterial({ color:0x8a7448, metalness:0.7, roughness:0.35 });
  box(0,0,0.02,1.24,1.62,0.06,giltMat,mirrorGroup);
  try {
    const { Reflector } = await import('three/addons/objects/Reflector.js');
    mirrorMesh = new Reflector(new THREE.PlaneGeometry(1.1,1.48), {
      clipBias: 0.003, textureWidth: 768, textureHeight: 768, color: 0x8b969c
    });
    mirrorMesh.position.z = 0.06;
    mirrorGroup.add(mirrorMesh);
  } catch (e) {
    mirrorMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1,1.48),
      new THREE.MeshStandardMaterial({ color:0x9fb0b8, metalness:1, roughness:0.05 }));
    mirrorMesh.position.z = 0.06; mirrorGroup.add(mirrorMesh);
  }
  mirrorMesh.userData = { interact:true, id:'mirror', label:'Mirror' };
  const l = new THREE.PointLight(0xdfe9ff, 2.2, 3.6, 2); l.position.set(-7.2, 2.2, 0.55); scene.add(l);
}
makeCeilingLamp(-6.4, 0.3, 0xdbe7ff, 2.8);

// ---------- HALLWAY ----------
makeRug(-1.5, 2.5, 8.5, 0.95);
{
  // console table
  const g=new THREE.Group(); g.position.set(-4.6,0,3.3); scene.add(g);
  const wd=new THREE.MeshStandardMaterial({color:0x33261b, roughness:0.7});
  box(0,0.82,0,1.4,0.05,0.34,wd,g);
  for(const [lx,lz] of [[-0.63,-0.12],[0.63,-0.12],[-0.63,0.12],[0.63,0.12]]) cyl(lx,0.41,lz,0.02,0.02,0.82,wd,g,6);
  box(0,0.95,0,0.18,0.26,0.12,new THREE.MeshStandardMaterial({color:0x1d2a34, roughness:0.4}),g);
  cyl(0.5,0.88,0,0.05,0.04,0.1,new THREE.MeshStandardMaterial({color:0x9a8a70, roughness:0.5}),g,10);
  addCollider(-4.6,3.3,1.4,0.4,'console');
}
// paintings in hall
function painting(x, z, rotY, w=0.7, h=0.9, seed=0){
  const frame=new THREE.Group(); frame.position.set(x,1.6,z); frame.rotation.y=rotY; scene.add(frame);
  box(0,0,0.01,w+0.08,h+0.08,0.035,new THREE.MeshStandardMaterial({color:0x3a2b1c, roughness:0.6}),frame);
  const tex = canvasTex(256,320,(c,cw,ch)=>{
    const hues = [['#2b3440','#5a4a3a'],['#3a2c2e','#6a5a44'],['#243028','#4a5a4a']][seed%3];
    const g=c.createLinearGradient(0,0,cw,ch); g.addColorStop(0,hues[0]); g.addColorStop(1,hues[1]);
    c.fillStyle=g; c.fillRect(0,0,cw,ch);
    for(let i=0;i<24;i++){ c.strokeStyle=`rgba(230,220,200,${Math.random()*0.12})`; c.lineWidth=1+Math.random()*3; c.beginPath(); c.moveTo(Math.random()*cw,Math.random()*ch); c.lineTo(Math.random()*cw,Math.random()*ch); c.stroke(); }
    c.fillStyle='rgba(0,0,0,0.35)'; c.fillRect(0,ch*0.7,cw,ch*0.3);
  });
  const art=new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshStandardMaterial({map:tex, roughness:0.9}));
  art.position.z=0.03; frame.add(art);
  return frame;
}
painting(-4.5, 1.62, 0, 0.75, 0.95, 1);
painting(2.5, 1.62, 0, 0.6, 0.8, 2);
painting(-7.98, 2.6, Math.PI/2, 0.5, 0.65, 0);
// coat rack
{
  const g=new THREE.Group(); g.position.set(7.4,0,1.85); scene.add(g);
  const m=new THREE.MeshStandardMaterial({color:0x2a2420, roughness:0.7});
  cyl(0,0.9,0,0.03,0.05,1.8,m,g,8);
  for(let i=0;i<3;i++){ const h=box(0.12,1.62,0,0.24,0.03,0.03,m,g); h.rotation.y=i*2.1; }
  box(0.02,1.25,0,0.36,0.6,0.18,new THREE.MeshStandardMaterial({color:0x3b3a36, roughness:1}),g);
}
// hall closet (hide spot)
box(-7.35, 1.1, 2.6, 0.8, 2.2, 0.62, new THREE.MeshStandardMaterial({color:0x2e2318, roughness:0.8}));
for (const zz of [2.36, 2.84]) box(-6.94, 1.1, zz, 0.04, 2.0, 0.42, new THREE.MeshStandardMaterial({color:0x241b12, roughness:0.8}));
addCollider(-7.35,2.6,0.8,0.62,'closet');
makeCeilingLamp(5.8, -3.0, 0xffd2a0, 2.6);
makeCeilingLamp(-2.5, 2.5, 0xffd6a0, 2.3);
{
  // wall sconce beside the front door
  const g = new THREE.Group(); g.position.set(7.88, 2.0, 3.18); scene.add(g);
  const metal = new THREE.MeshStandardMaterial({ color:0x2a2724, metalness:0.6, roughness:0.4 });
  box(0, 0, 0, 0.1, 0.22, 0.16, metal, g);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.14,0.2,14,1,true),
    new THREE.MeshStandardMaterial({ color:0xe4d3b0, roughness:0.95, side:THREE.DoubleSide, emissive:0x3a2814, emissiveIntensity:0.55 }));
  shade.position.set(-0.08, 0, 0); g.add(shade);
  const l = new THREE.PointLight(0xffc98c, 3.2, 4.0, 2); l.position.set(-0.3, -0.02, 0); g.add(l);
}
makeCeilingLamp(5.0, 2.5, 0xffd6a0, 2.1);

// ---------- STUDY ----------
{
  const g=new THREE.Group(); g.position.set(6.0,0,4.35); scene.add(g);
  const wd=new THREE.MeshStandardMaterial({color:0x35271b, roughness:0.72});
  box(0,0.74,0,1.75,0.06,0.78,wd,g);
  box(-0.82,0.37,0,0.06,0.74,0.72,wd,g);
  box(0.82,0.37,0,0.06,0.74,0.72,wd,g);
  box(0,0.5,0,1.6,0.4,0.06,wd,g);
  addCollider(6.0,4.35,1.75,0.8,'desk');
  // CRT monitor
  box(0.3,0.98,-0.1,0.5,0.4,0.42,new THREE.MeshStandardMaterial({color:0x1d1f21, roughness:0.6}),g);
  const scr=new THREE.Mesh(new THREE.PlaneGeometry(0.4,0.28), new THREE.MeshBasicMaterial({color:0x2f6b52}));
  scr.position.set(0.3,0.98,0.115); g.add(scr);
  const crtGlow = new THREE.PointLight(0x5fd6a4, 0.7, 1.6, 2); crtGlow.position.set(0.3,1.0,0.25); g.add(crtGlow);
  // papers
  for(let i=0;i<4;i++){ const p=box(-0.3+Math.random()*0.3,0.78,-0.05+Math.random()*0.3,0.22,0.004,0.3,new THREE.MeshStandardMaterial({color:0xd8d3c6, roughness:1}),g); p.rotation.y=Math.random(); }
  // desk lamp
  const lm=new THREE.MeshStandardMaterial({color:0x232326, metalness:0.6, roughness:0.4});
  cyl(-0.5,0.94,0.12,0.02,0.02,0.3,lm,g,6);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(0.1,0.14,12,1,true),lm); shade.position.set(-0.5,1.1,0.12); shade.rotation.x=Math.PI; g.add(shade);
  const dl=new THREE.PointLight(0xffcf95, 3.4, 4.0, 2); dl.position.set(-0.5,1.05,0.12); g.add(dl);
  // chair
  const ch=new THREE.Group(); ch.position.set(6.0,0,4.95); ch.rotation.y=Math.PI; scene.add(ch);
  const cm=new THREE.MeshStandardMaterial({color:0x2a2c30, roughness:0.8});
  box(0,0.46,0,0.44,0.06,0.44,cm,ch);
  box(0,0.72,-0.2,0.44,0.54,0.05,cm,ch);
  cyl(0,0.25,0,0.03,0.03,0.4,cm,ch,8);
}
makeRug(6.1, 4.7, 2.4, 1.9);
makeShelf(6.2, 5.78, 2.6, 0.3, 2.1, Math.PI);
// breaker panel
const breaker = box(7.9, 1.45, 4.6, 0.06, 0.8, 0.55, new THREE.MeshStandardMaterial({ color:0x6d7074, metalness:0.45, roughness:0.45 }));
const breakerLed = new THREE.Mesh(new THREE.CircleGeometry(0.02,10), new THREE.MeshBasicMaterial({color:0x3a0a0a}));
breakerLed.position.set(7.86,1.7,4.6); breakerLed.rotation.y = -Math.PI/2; scene.add(breakerLed);
reg(breaker, 'breaker', 'Open the breaker panel', ()=>{});

// ---------- THE COPY LIVING ROOM ----------
const copyGroup = new THREE.Group(); scene.add(copyGroup);
{
  const old = scene; // build into scene then move? simpler: leave in scene, hidden by walls until revealed
}
makeCeilingLamp(-0.6, 4.7, 0xffd2a8, 3.0);
const tvGlow = new THREE.PointLight(0x8fb4ff, 0, 4.5, 2);
tvGlow.position.set(-0.6, 1.35, 5.2); scene.add(tvGlow);
{
  // dim floor lamp mirrored from the living room
  makeLamp(-2.35, 4.3, 1.5, 0xffb877, 7.5);
  // rim light so the seated figure has a readable silhouette
  const rim = new THREE.SpotLight(0xaec4ea, 10, 6, 0.8, 1.0, 1.5);
  rim.position.set(-0.6, 2.25, 3.75);
  rim.target.position.set(-0.6, 1.05, 4.9);
  scene.add(rim); scene.add(rim.target);
}
const copySofa = makeSofa(-0.6, 5.15, 0, 0x3a3f4a);
makeTable(-0.6, 4.25, 1.5, 0.68, 0.44);
makeRug(-0.6, 4.4, 3.2, 2.2);
makeShelf(3.22, 4.55, 1.8, 0.34, 2.0, -Math.PI/2);
painting(-2.98, 4.65, Math.PI/2, 0.7, 0.9, 2);
{
  const g = new THREE.Group(); g.position.set(-2.45, 0, 5.45); scene.add(g);
  cyl(0, 0.16, 0, 0.16, 0.13, 0.32, new THREE.MeshStandardMaterial({color:0x4a3a2c, roughness:0.9}), g, 12);
  const leafMat = new THREE.MeshStandardMaterial({color:0x2a4a30, roughness:0.9, side:THREE.DoubleSide});
  for (let i=0;i<9;i++){
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.5,6), leafMat);
    l.position.set((Math.random()-0.5)*0.2, 0.45+Math.random()*0.4, (Math.random()-0.5)*0.2);
    l.rotation.set((Math.random()-0.5)*0.8, Math.random()*6, (Math.random()-0.5)*0.8); g.add(l);
  }
  addCollider(-2.45, 5.45, 0.4, 0.4, 'plant');
}

// ============================================================
//  FIGURES
// ============================================================
function makeFigure(opts={}){
  const { clothes=0x141416, skin=0x141416, seated=false, armLen=0.6, neckLen=0.16, headScale=1 } = opts;
  const g = new THREE.Group();
  const cm = new THREE.MeshStandardMaterial({ color:clothes, roughness:0.95, map: matFrom(fabricWeave,1,1,clothes).map });
  const sm = new THREE.MeshStandardMaterial({ color:skin, roughness:0.85 });
  const hipsY = seated ? 0.52 : 0.95;
  const hips = new THREE.Group(); hips.position.y = hipsY; g.add(hips);
  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155,0.44,6,14), cm);
  torso.scale.set(1.15,1,0.7); torso.position.y = 0.3; hips.add(torso);
  // shoulders
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.06,0.32,4,10), cm);
  shoulders.rotation.z = Math.PI/2; shoulders.position.y = 0.5; hips.add(shoulders);
  // neck (unnaturally long for the Tenant)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.055,neckLen,10), sm);
  neck.position.y = 0.56 + neckLen/2; hips.add(neck);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115*headScale,20,16), sm);
  head.scale.set(0.84,1.14,0.94);
  head.position.y = 0.56 + neckLen + 0.1*headScale; hips.add(head);
  // hair: cap + nape, so the back of the head reads as a person
  const hairMat = new THREE.MeshStandardMaterial({ color:0x241c17, roughness:1 });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.12*headScale,18,14,0,Math.PI*2,0,Math.PI*0.6), hairMat);
  hair.scale.set(0.88,1.02,0.96); hair.position.y = 0.6 + neckLen + 0.1*headScale; hips.add(hair);
  const nape = new THREE.Mesh(new THREE.SphereGeometry(0.105*headScale,16,12), hairMat);
  nape.scale.set(0.88,0.72,0.7);
  nape.position.set(0, 0.57 + neckLen + 0.1*headScale, -0.045); hips.add(nape);
  // ears
  for (const side of [-1,1]){
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024,8,6), sm);
    ear.scale.set(0.6,1.2,0.9);
    ear.position.set(side*0.098, 0.59 + neckLen + 0.1*headScale, 0); hips.add(ear);
  }
  // collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.062,0.02,6,12), cm);
  collar.rotation.x = Math.PI/2;
  collar.position.y = 0.555 + neckLen*0.5; hips.add(collar);
  // arms
  const arms = [];
  for (const side of [-1,1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side*0.215, 0.48, 0); hips.add(pivot);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.042,armLen*0.7,4,8), cm);
    upper.position.y = -armLen*0.35; pivot.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045,8,6), sm);
    hand.position.y = -armLen*0.78; hand.scale.set(0.9,1.15,0.8); pivot.add(hand);
    pivot.rotation.z = side*0.06;
    arms.push(pivot);
  }
  // legs
  const legs = [];
  for (const side of [-1,1]) {
    const hip = new THREE.Group(); hip.position.set(side*0.09, 0, 0); hips.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.058,0.34,4,10), cm);
    thigh.position.y = -0.22; hip.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05,0.32,4,10), cm);
    shin.position.y = -0.58; hip.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.05,0.2), cm);
    foot.position.set(0,-0.78,0.05); hip.add(foot);
    if (seated) {
      hip.rotation.x = -Math.PI/2.1;
      hip.position.y = 0;
      shin.position.set(0, -0.36, 0.34);
      shin.rotation.x = Math.PI/2.2;
      foot.position.set(0, -0.66, 0.42);
      foot.rotation.x = -Math.PI/2.2;
      hip.position.z = 0.05;
    }
    legs.push(hip);
  }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function faceXZ(obj, x, z){
  obj.rotation.set(0, Math.atan2(x - obj.position.x, z - obj.position.z), 0);
}

// The Tenant — too tall, too thin, head too small, arms too long.
const tenant = makeFigure({ clothes:0x08080a, skin:0x0b0b0d, armLen:0.82, neckLen:0.26, headScale:0.86 });
tenant.scale.set(0.94, 1.11, 0.94);
tenant.visible = false;
scene.add(tenant);

// The double — you, but seated facing the television.
const doubleSeated = makeFigure({ clothes:0x3b4250, skin:0x8b7c6c, seated:true });
doubleSeated.visible = false; scene.add(doubleSeated);
const doubleStanding = makeFigure({ clothes:0x3b4250, skin:0x8b7c6c });
doubleStanding.visible = false; scene.add(doubleStanding);

// mirror apparition
const mirrorFigure = makeFigure({ clothes:0x0d0d10, skin:0x141416, armLen:0.8, neckLen:0.24, headScale:0.88 });
mirrorFigure.visible = false; scene.add(mirrorFigure);

// ============================================================
//  LIGHTING — moonlight + practicals
// ============================================================
const ambient = new THREE.AmbientLight(0x33405a, 0.55); scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x4a5b80, 0x2c231b, 0.6); scene.add(hemi);
const bounce = new THREE.DirectionalLight(0xbfae95, 0.34);
bounce.position.set(-4, 6, 4); bounce.target.position.set(0,0,0); scene.add(bounce); scene.add(bounce.target);
const moon = new THREE.DirectionalLight(0x93b4dc, 1.5);
moon.position.set(6, 9, -14); moon.target.position.set(0,0,0);
moon.castShadow = true;
moon.shadow.mapSize.set(2048,2048);
moon.shadow.camera.left = -14; moon.shadow.camera.right = 14;
moon.shadow.camera.top = 14; moon.shadow.camera.bottom = -14;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 40;
moon.shadow.bias = -0.0008;
scene.add(moon); scene.add(moon.target);

// soft ceiling washes so furniture reads without burning the ceiling
const fills = [
  [0xa9bde0, 11.0, -5.4, -3.2],   // bedroom
  [0xb0c4e6, 12.0, -0.8, -2.6],   // living
  [0xffd6a8, 10.0, 5.9, -2.8],    // kitchen
  [0xd8e6ff, 6.0, -6.3, 0.3],     // bathroom
  [0xffd3a0, 8.0, 0.0, 2.5],      // hallway
  [0xffcf9c, 8.0, 6.0, 4.7],      // study
  [0xa8bee8, 7.0, -0.6, 4.6]      // copy room
];
for (const [c,i,x,z] of fills){
  const l = new THREE.SpotLight(c, i, 12, 1.16, 1.0, 1.6);
  l.position.set(x, 2.62, z);
  l.target.position.set(x, 0, z);
  scene.add(l); scene.add(l.target);
}

// flush ceiling fixtures where the soft washes pool, so the glow has a source
function flushFixture(x, z){
  const g = new THREE.Group(); g.position.set(x, 2.73, z); scene.add(g);
  cyl(0, 0.015, 0, 0.13, 0.13, 0.03,
    new THREE.MeshStandardMaterial({ color:0x2a2724, metalness:0.5, roughness:0.5 }), g, 18);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshStandardMaterial({ color:0xe6dcc7, roughness:0.9, emissive:0xffd7a0, emissiveIntensity:0.28 }));
  dome.rotation.x = Math.PI; dome.position.y = -0.02; g.add(dome);
}
flushFixture(-5.4, -3.2);
flushFixture(-0.8, -2.6);

// bedroom practical
makeCeilingLamp(-6.9, -1.95, 0xffcf9e, 1.5);

// flashlight
const flash = new THREE.SpotLight(0xfff0d2, 0, 22, 0.52, 0.45, 1.4);
flash.castShadow = true;
flash.shadow.mapSize.set(1024,1024);
flash.shadow.bias = -0.0009;
scene.add(flash); scene.add(flash.target);

// dust motes
{
  const count = 420;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count*3);
  for (let i=0;i<count;i++){
    pos[i*3] = (Math.random()-0.5)*19;
    pos[i*3+1] = Math.random()*2.7;
    pos[i*3+2] = (Math.random()-0.5)*11.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat = new THREE.PointsMaterial({ color:0x9a8f7a, size:0.011, transparent:true, opacity:0.22, depthWrite:false });
  const dust = new THREE.Points(geo, mat); scene.add(dust);
  window.__dust = dust;
}

// ============================================================
//  UI HELPERS
// ============================================================
let toastTimer = null;
function toast(text, dur=4200){
  const el = document.getElementById('toast');
  el.textContent = text; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>{ el.style.display='none'; }, dur);
}
let subTimer = null;
function subtitle(text, dur=3400){
  const el = document.getElementById('subtitle');
  el.textContent = text;
  clearTimeout(subTimer); subTimer = setTimeout(()=>{ el.textContent=''; }, dur);
}
function updateInventory(){
  const el = document.getElementById('invList');
  if (!el) return;
  const items = [];
  items.push(S.hasTorch ? 'Flashlight  [F]' : '— no light —');
  items.push(S.hasKey ? 'Spare key' : '— no key —');
  if (S.hasTape) items.push('VHS tape');
  const truths = Object.values(S.truth).filter(Boolean).length;
  el.innerHTML = items.join('<br>') + `<br>Proof found: ${truths}/3`;
}

// ============================================================
//  PHONE
// ============================================================
const phoneEl = document.getElementById('phone');
const msgsEl = document.getElementById('msgs');
const badge = document.getElementById('phoneBadge');
let phoneOpen = false;
let suppressPauseUntil = 0;

function addMsg(who, text){
  const d = document.createElement('div');
  d.className = 'msg' + (who==='me' ? ' me' : '');
  d.innerHTML = `${text}<span class="t">${who==='me'?'YOU':'YOUR CONTACT'} · 3:17 AM · tomorrow</span>`;
  msgsEl.appendChild(d); msgsEl.scrollTop = msgsEl.scrollHeight;
  if (!phoneOpen){ badge.style.display='flex'; badge.classList.add('has'); }
  if (AC) playStatic(0.02, 0.12);
}
function phoneScript(n){
  const scripts = {
    1: ["Don't turn around. I'm trying to keep it away from you."],
    2: [`You have checked behind you ${profile.glances} times tonight. It notices patterns.`],
    3: ["Power's back. The television is on. Watch it — but don't go where it shows you unless you want the truth."],
    4: ["It learns where you hide. Never hide twice in the same closet."],
    5: ["It sits facing away. Turn around and it will be gone. Keep facing it. Breathe."],
    6: ["The hallway is longer now. That isn't the building. That's you."],
    7: ["You have all three proofs. The mirror is the last door. Or the front door. Choose."]
  };
  (scripts[n]||[]).forEach((s,i)=>setTimeout(()=>addMsg('them', s), i*2600));
}
function togglePhone(force){
  phoneOpen = (force !== undefined) ? force : !phoneOpen;
  phoneEl.style.display = phoneOpen ? 'flex' : 'none';
  if (phoneOpen){
    badge.style.display='none'; badge.classList.remove('has');
    suppressPauseUntil = Date.now()+500;
    document.exitPointerLock && document.exitPointerLock();
  } else if (S.started && !S.ended) {
    suppressPauseUntil = Date.now()+500;
    lockPointer();
  }
}
document.getElementById('phoneClose').onclick = ()=>togglePhone(false);
badge.onclick = ()=>togglePhone(true);

// ============================================================
//  INPUT
// ============================================================
const keys = {};
addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (e.key === 'Tab'){ e.preventDefault(); if (S.started && !S.ended) togglePhone(); return; }
  if (k === 'f' && S.hasTorch && S.started){
    S.lightOn = !S.lightOn;
    flash.intensity = S.lightOn ? 26 : 0;
    toast(S.lightOn ? 'Flashlight on. The light makes you easier to see, too.' : 'Flashlight off.');
    if (S.lightOn) S.awareness = Math.max(0, S.awareness-4); else S.awareness += 3;
  }
  if (k === 'e' && S.started && !S.ended) interact();
  if (k === 'c' && S.started){
    S.sneak = !S.sneak;
    toast(S.sneak ? 'Sneaking. Your footsteps go quiet.' : 'Standing. Your footsteps are back.');
  }
  if (e.key === 'Escape' && S.started && !S.ended && !phoneOpen) showPause();
});
addEventListener('keyup', e=>{ keys[e.key.toLowerCase()] = false; });
addEventListener('mousemove', e=>{
  if (document.pointerLockElement !== canvas) return;
  if (Date.now() - lockAcquiredAt < 500) return;
  if (lockSkip > 0) { lockSkip--; return; }
  const dx = THREE.MathUtils.clamp(e.movementX, -60, 60);
  const dy = THREE.MathUtils.clamp(e.movementY, -60, 60);
  const prev = yaw;
  yaw -= dx*0.0021;
  pitch = THREE.MathUtils.clamp(pitch - dy*0.0021, -1.35, 1.35);
  const delta = Math.abs(((yaw-prev)*180/Math.PI + 540) % 360 - 180);
  if (delta > 92 && Date.now() - S.behindCooldown > 1600){
    S.behindCooldown = Date.now();
    profile.glances++; saveProfile();
    S.awareness += 4;
    updateUnease(S.unease + 3);
    if (profile.glances === 2) subtitle('— you checked behind you. The room was empty. —');
    if (profile.glances === 4) setTimeout(()=>{ addMsg('them', "You do that a lot. It likes when you do that."); playWhisper(new THREE.Vector3(player.position.x-1.5,0,player.position.z-1)); }, 1400);
    if (profile.glances === 6) setTimeout(behindManifest, 900);
    if (profile.glances > 6 && profile.glances % 4 === 0) setTimeout(behindManifest, 700);
  }
});
let lockAcquiredAt = 0, lockSkip = 3;
function lockPointer(){
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(()=>{});
  } catch(e){}
  lockAcquiredAt = Date.now();
}
document.addEventListener('pointerlockchange', ()=>{
  if (document.pointerLockElement === canvas){ lockAcquiredAt = Date.now(); lockSkip = 3; }
  if (!document.pointerLockElement && S.started && !S.ended && !phoneOpen && !S.paused){
    if (Date.now() < suppressPauseUntil) return;
    showPause();
  }
});

// touch
let joyVec = { x:0, y:0 };
if ('ontouchstart' in window){
  document.getElementById('touchUI').style.display = 'block';
  const joy = document.getElementById('joy'), knob = document.getElementById('joyKnob');
  let jid = null;
  joy.addEventListener('touchstart', e=>{ jid = e.touches[0].identifier; }, {passive:true});
  joy.addEventListener('touchmove', e=>{
    const t = [...e.touches].find(t=>t.identifier===jid); if (!t) return;
    const r = joy.getBoundingClientRect();
    let dx = t.clientX-(r.left+56), dy = t.clientY-(r.top+56);
    const d = Math.hypot(dx,dy); if (d>40){ dx*=40/d; dy*=40/d; }
    knob.style.left = (36+dx)+'px'; knob.style.top = (36+dy)+'px';
    joyVec = { x:dx/40, y:dy/40 };
  }, {passive:true});
  joy.addEventListener('touchend', ()=>{ joyVec={x:0,y:0}; knob.style.left='36px'; knob.style.top='36px'; });
  document.getElementById('tInteract').onclick = ()=>interact();
  document.getElementById('tLight').onclick = ()=>{ if(S.hasTorch){ S.lightOn=!S.lightOn; flash.intensity=S.lightOn?26:0; } };
  document.getElementById('tPhone').onclick = ()=>togglePhone();
  let lx=null, ly=null;
  canvas.addEventListener('touchmove', e=>{
    const t = e.touches[0];
    if (lx!==null){ yaw -= (t.clientX-lx)*0.005; pitch = THREE.MathUtils.clamp(pitch-(t.clientY-ly)*0.005,-1.35,1.35); }
    lx=t.clientX; ly=t.clientY;
  }, {passive:true});
  canvas.addEventListener('touchend', ()=>{ lx=null; ly=null; });
}

// ============================================================
//  INTERACTION
// ============================================================
const raycaster = new THREE.Raycaster();
let current = null;
function interact(){
  if (!current) return;
  const u = current.userData;
  if (u.door){ toggleDoor(u.door); return; }
  switch (u.id){
    case 'frontDoor': tryFrontDoor(); return;
    case 'mirror': lookMirror(); return;
    case 'photo': lookPhoto(current); return;
    case 'tv': watchTV(); return;
    case 'sofaCopy': sitCopySofa(); return;
  }
  if (u.id && u.id.startsWith('hide_')){ toggleHide(u.id); return; }
  if (actions[u.id]){ actions[u.id](); return; }
}
function toggleDoor(d){
  if (d.locked){ toast('Locked.'); playKnock(d.g.position, 0.3); return; }
  d.open = !d.open;
  d.pivot.rotation.y = d.open ? d.openRot : 0;
  const i = colliders.indexOf(d.col);
  if (d.open && i>=0) colliders.splice(i,1);
  else if (!d.open && i<0) colliders.push(d.col);
  if (AC) playCreak();
  S.awareness += 0.4;
}
function updateInteract(){
  raycaster.setFromCamera({x:0,y:0}, camera);
  raycaster.far = 3.0;
  const objs = [];
  const chainVisible = o => { let n = o; while (n){ if (!n.visible) return false; n = n.parent; } return true; };
  scene.traverse(o=>{
    if (o.userData && o.userData.interact && chainVisible(o)) objs.push(o);
  });
  const hit = raycaster.intersectObjects(objs, false)[0];
  const prompt = document.getElementById('prompt');
  if (hit){
    current = hit.object;
    const label = current.userData.label || 'Interact';
    prompt.innerHTML = `<b>[E]</b> ${label}`;
    prompt.style.display = 'block';
  } else {
    current = null;
    prompt.style.display = 'none';
  }
}

// ============================================================
//  HIDE SPOTS
// ============================================================
{
  const closetDoorMat = new THREE.MeshStandardMaterial({ color:0x2a1e15, roughness:0.8 });
  const hb = box(-3.135, 1.05, -5.35, 0.02, 1.96, 1.0, closetDoorMat);
  reg(hb, 'hide_bed', 'Hide in the closet', ()=>{});
  const hh = box(-6.925, 1.1, 2.6, 0.02, 2.02, 0.56, closetDoorMat);
  reg(hh, 'hide_hall', 'Hide in the closet', ()=>{});
  // study wardrobe
  box(3.82, 1.05, 4.85, 0.55, 2.1, 1.15, closetDoorMat);
  box(4.1, 1.05, 4.85, 0.02, 1.96, 1.06, closetDoorMat);
  addCollider(3.82, 4.85, 0.55, 1.15, 'wardrobe');
  const hs = box(4.115, 1.05, 4.85, 0.02, 1.9, 1.0, closetDoorMat);
  reg(hs, 'hide_study', 'Hide in the wardrobe', ()=>{});
}
// copy sofa seat hit-box
{
  const seat = box(-0.6, 0.62, 5.05, 2.3, 0.42, 0.86, new THREE.MeshBasicMaterial({ transparent:true, opacity:0 }));
  reg(seat, 'sofaCopy', 'Sit on the sofa', ()=>{});
}

// ============================================================
//  ACTIONS
// ============================================================
actions.torch = ()=>{
  S.hasTorch = true; torch.visible = false;
  updateInventory();
  toast('A flashlight. It was not there when you went to sleep.');
  setObjective(1);
  setTimeout(()=>addMsg('them', "Good. You found it. Now look at your phone. Please."), 2200);
};
actions.phoneObj = ()=>{ togglePhone(true); if (S.phase < 1) setObjective(1); };
actions.diary = ()=>{
  S.truth.diary = true; updateInventory();
  toast('Your handwriting. “Night 41. It sits on my sofa and watches the television. Tomorrow I will be the one sitting.”');
  subtitle('— the ink is still wet —');
  if (AC) playWhisper(null, 1.2);
  checkProofs();
};
actions.note1 = ()=>{ toast('A note in your handwriting: “If you find the other living room, do not sit down. — you”'); };
actions.note2 = ()=>{ toast('“The television shows the room you are not in. That is how you know it is real.”'); };
actions.key = ()=>{
  if (S.hasKey){ toast('The drawer is empty now. It smells like your hands.'); return; }
  S.hasKey = true; updateInventory();
  toast('The spare key. Warm, as if someone was holding it a second ago.');
  setObjective(3);
  if (AC) playKnock(new THREE.Vector3(8,0,2), 0.35);
  setTimeout(()=>addMsg('them', "Don't use it yet. The deadbolt needs power. The breaker is in the study."), 2000);
};
actions.breaker = ()=>{
  if (S.power){ toast('The breaker is already on. Flipping it off feels like an invitation.'); return; }
  S.power = true;
  breakerLed.material.color.set(0x35ff70);
  scene.traverse(o=>{ if (o.isPointLight && o.intensity < 6) o.intensity *= 1.35; });
  toast('The apartment hums back to life. Somewhere, a television wakes up.');
  setObjective(4);
  if (AC) playThud(0.3);
  setTimeout(()=>{
    S.tvOn = true; tvScreenMat.map = tvRT.texture; tvScreenMat.needsUpdate = true;
    if (AC) playStatic(0.09, 1.4);
    toast('The television in the living room turned itself on.');
  }, 4500);
  phoneScript(3);
};
actions.tape = ()=>{
  if (S.hasTape){ toast('The case is empty. The tape is inside the machine.'); return; }
  S.hasTape = true; S.truth.tape = true; updateInventory();
  toast('A VHS tape. The label, in your handwriting: “DO NOT PLAY — 3:17 AM”.');
  checkProofs();
};
actions.tv = ()=>{}; // handled

function lookPhoto(m){
  const idx = (S.truth.photo ? 1 : 0);
  const next = 1 - idx;
  m.material.map = (next ? photoTexB : photoTexA).clone();
  m.material.map.needsUpdate = true;
  m.material.needsUpdate = true;
  if (!S.truth.photo){
    S.truth.photo = true; updateInventory();
    toast('In the photograph, there are three of you. One of them is facing the wrong way. It was not like that a moment ago.');
    checkProofs();
  } else {
    toast('You look away. You look back. Now there are four.');
    S.awareness += 6; updateUnease(S.unease+5);
  }
  if (AC) playWhisper(null, 1.1);
}
function checkProofs(){
  const n = Object.values(S.truth).filter(Boolean).length;
  if (n >= 3 && S.phase < 7){
    if ((S.copyVisits||0) > 0){
      setObjective(7);
      subtitle('— you have enough. Now the mirror. —');
      setTimeout(()=>phoneScript(7), 1200);
    } else {
      setObjective(6);
      subtitle('— three proofs. Now the room the television shows. —');
    }
  }
}
function lookMirror(){
  profile.mirrorLooks++; saveProfile();
  S.mirrorLooked++;
  updateUnease(S.unease + 7);
  if (AC) playWhisper(new THREE.Vector3(player.position.x, 0, player.position.z+1.5), 1.4);
  // apparition behind the player — visible only in the mirror
  const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.55);
  mirrorFigure.position.copy(player.position).add(back);
  mirrorFigure.position.y = 0;
  faceXZ(mirrorFigure, player.position.x, player.position.z);
  mirrorFigure.visible = true;
  setTimeout(()=>{ mirrorFigure.visible = false; }, 2600);
  subtitle('— in the mirror, something stands behind you. —');

  const n = Object.values(S.truth).filter(Boolean).length;
  if (n >= 3 && S.copyVisits > 0){
    setTimeout(()=>{ playSilence(1.6); endGame('truth'); }, 5200);
    toast('Your reflection turns its head before you do. In the glass, the sofa is empty. In the glass, you are alone.');
  } else if (n >= 3){
    toast('Three proofs. But the mirror shows a door you have not opened yet. Find the room the television shows.');
  } else {
    toast(`Your reflection lags. It is always half a second behind you. You still need ${3-n} more proof.`);
  }
}
function watchTV(){
  profile.tvWatches++; saveProfile();
  if (!S.tvOn){ toast('The screen is black. In the glass you can see the room behind you. Nothing is there. Yet.'); return; }
  S.tvWatches++;
  if (AC) playStatic(0.05, 0.5);
  if (S.tvWatches === 1){
    toast('The television is showing your living room. From the ceiling. You are standing in it, very small. Something is standing in the doorway behind you.');
    subtitle('— you turn around. The doorway is empty. —');
    S.awareness += 10; updateUnease(S.unease+8);
  } else if (!S.copyRevealed){
    revealCopyRoom();
  } else {
    toast('The same room. The same angle. This time, the figure in the doorway is closer.');
    S.awareness += 6; updateUnease(S.unease+5);
    if (S.doubleStage === 0) triggerDouble(1);
  }
}
function revealCopyRoom(){
  if (S.copyRevealed) return;
  S.copyRevealed = true;
  setObjective(5);
  hiddenWallMesh.visible = false;
  const i = colliders.indexOf(hiddenCol); if (i >= 0) colliders.splice(i,1);
  const d = doors.find(x=>x.id==='copyDoor');
  d.g.visible = true;
  d.col.x1 = -1.08; d.col.x2 = 0.78; d.col.z1 = 3.4; d.col.z2 = 3.6;
  colliders.push(d.col);
  tvCopy.g.visible = true;
  if (AC) playCreak();
  toast('In the hallway, where there was only wallpaper, there is now a door.');
  subtitle('— it is warm to the touch —');
  setTimeout(()=>phoneScript(5), 1600);
}
function triggerDouble(stage){
  S.doubleStage = stage;
  if (stage === 1){
    doubleSeated.visible = true;
    doubleSeated.position.set(-0.6, 0, 4.98);
    doubleSeated.rotation.y = 0; // facing the television, back to the door
    if (!S.doubleSeen){
      S.doubleSeen = true;
      toast('Someone is sitting on the sofa. Facing away. They are wearing your clothes.');
      subtitle('— the television shows you, standing behind them —');
      updateUnease(S.unease+18);
      setTimeout(()=>addMsg('them', "Don't turn around. That's not me. I'm trying to keep it away from you."), 2500);
    }
  } else if (stage === 2){
    doubleSeated.visible = false;
    doubleStanding.visible = true;
    doubleStanding.position.set(-0.6, 0, 4.85);
    doubleStanding.rotation.y = 0;
    toast('The sofa is empty. But something is standing in the middle of the room now. Facing you.');
    updateUnease(S.unease+22);
    if (AC) playThud(0.4);
  }
}
function sitCopySofa(){
  if (S.doubleStage >= 2){ endGame('replacement'); return; }
  toast('You don\'t sit. Your legs want to. The cushion is still warm.');
  updateUnease(S.unease+6);
}
function toggleHide(id){
  if (S.hiding){
    S.hiding = null;
    if (S.hideReturn) player.position.copy(S.hideReturn);
    document.getElementById('vignette').style.background = 'radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.9) 100%)';
    toast('You step out. The room feels closer than it did.');
    return;
  }
  S.hideReturn = player.position.clone();
  S.hiding = id;
  profile.hides[id] = (profile.hides[id]||0) + 1; saveProfile();
  document.getElementById('vignette').style.background = 'radial-gradient(ellipse at center,transparent 8%,rgba(0,0,0,.99) 60%)';
  toast('You pull the door closed. Your breathing is the loudest thing in the apartment. [E] to leave.');
  S.awareness += 6; updateUnease(S.unease+4);
  const times = profile.hides[id];
  if (times >= 2){
    setTimeout(()=>{
      if (!S.hiding) return;
      playKnock(new THREE.Vector3(player.position.x,0,player.position.z), 0.5);
      subtitle('— knocking. From outside the door. It knows this one. —');
      addMsg('them', "You hid there before. It remembers. Don't do this again.");
    }, 5200);
  }
  if (times >= 3){
    setTimeout(()=>{
      if (!S.hiding) return;
      updateUnease(90); S.awareness += 25;
      playThud(0.6);
      subtitle('— the door handle turns —');
    }, 9000);
  }
}
function tryFrontDoor(){
  if (!S.hasKey){
    if (S.phase < 2) setObjective(2);
    toast('Locked. The keyhole is warm. There is a spare key in the kitchen.');
    if (AC) playKnock(new THREE.Vector3(8,0,2), 0.4);
    return;
  }
  if (!S.power){ toast('The electronic deadbolt is dead. No power. The breaker is in the study.'); return; }
  if (S.doubleStage >= 1 && S.doubleStage < 2){
    toast('You unlock it. The handle turns. On the other side of the door you can hear someone breathing who is also you.');
    if (AC) playWhisper(null, 1.6);
    updateUnease(S.unease+10);
    setTimeout(()=>endGame('escape'), 2600);
    return;
  }
  endGame('escape');
}

// ============================================================
//  TENANT BEHAVIOUR
// ============================================================
function behindManifest(){
  const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.35);
  tenant.position.copy(player.position).add(back);
  tenant.position.y = 0;
  faceXZ(tenant, player.position.x, player.position.z);
  tenant.visible = true;
  if (AC){ playWhisper(tenant.position, 1.2); playThud(0.35); }
  updateUnease(S.unease + 12);
  subtitle('— it was directly behind you —');
  setTimeout(()=>{ tenant.visible = false; }, 900);
}
function endOfHallManifest(){
  tenant.position.set(7.2, 0, 2.5);
  tenant.rotation.y = -Math.PI/2;
  tenant.visible = true;
  if (AC) playThud(0.25);
  updateUnease(S.unease + 8);
  subtitle('— something is standing at the end of the hallway —');
  setTimeout(()=>{ tenant.visible = false; }, 2400);
}
function stretchHallway(){
  if (S.stretched) return; S.stretched = true;
  const blink = document.createElement('div');
  blink.style.cssText = 'position:fixed;inset:0;background:#000;z-index:25;opacity:0;transition:opacity .45s;pointer-events:none';
  document.body.appendChild(blink);
  requestAnimationFrame(()=>{ blink.style.opacity='1'; });
  setTimeout(()=>{
    player.position.x = Math.max(-6, player.position.x - 3.2);
    if (AC) playCreak();
    blink.style.opacity='0';
    setTimeout(()=>blink.remove(), 600);
    toast('You have been walking toward the door for some time. The hallway is longer than it was.');
    updateUnease(S.unease+8);
  }, 480);
}

// small changes when a room is unobserved
const mutable = { chairRot: 0, mug: null, painting: null };
function mutateRoom(room){
  const roll = Math.random();
  if (roll < 0.34 && photos.length){
    const p = photos[(Math.random()*photos.length)|0];
    p.material.map = (Math.random()<0.5 ? photoTexA : photoTexB).clone();
    p.material.needsUpdate = true;
  } else if (roll < 0.6){
    const mug = scene.children.find(o=>o.geometry && o.geometry.type==='CylinderGeometry' && Math.abs(o.position.y-0.4)<0.05);
    if (mug) mug.position.x += (Math.random()-0.5)*0.5;
  } else if (roll < 0.8){
    if (AC) playCreak();
    subtitle('— something settles in the wall —');
  } else {
    if (AC) playKnock(new THREE.Vector3(player.position.x + (Math.random()-0.5)*6, 0, player.position.z + (Math.random()-0.5)*6), 0.18);
  }
}
function onRoomChange(from, to){
  if (from === to) return;
  if (from && Math.random() < 0.55) setTimeout(()=>mutateRoom(from), 900);
  if (to === 'hall') S.hallTime = 0;
  if (to === 'copy'){
    S.copyVisits++;
    if (Object.values(S.truth).filter(Boolean).length >= 3 && S.phase < 7){
      setObjective(7);
      setTimeout(()=>phoneScript(7), 1600);
    }
    if (S.doubleStage === 0){ setTimeout(()=>triggerDouble(1), 900); }
    else if (S.doubleStage === 1.5){ setTimeout(()=>triggerDouble(2), 1200); }
  }
  if (to === 'study' && !S.power && S.phase >= 3) subtitle('— the breaker panel is on the east wall —');
  if (to === 'kitchen' && !S.hasKey && S.phase >= 2) subtitle('— the drawer by the sink —');
}

// ============================================================
//  ROOMS & MOVEMENT
// ============================================================
function roomAt(x, z){
  if (z >= 3.5) return x >= 3.5 ? 'study' : 'copy';
  if (z >= 1.5) return 'hall';
  if (x <= -3) return (x <= -5 && z >= -1) ? 'bath' : 'bedroom';
  if (x >= 3.5) return 'kitchen';
  return 'living';
}
const PR = 0.26;
function collide(pos){
  for (const c of colliders){
    if (pos.x > c.x1-PR && pos.x < c.x2+PR && pos.z > c.z1-PR && pos.z < c.z2+PR){
      const dx1 = pos.x-(c.x1-PR), dx2 = (c.x2+PR)-pos.x;
      const dz1 = pos.z-(c.z1-PR), dz2 = (c.z2+PR)-pos.z;
      const m = Math.min(dx1,dx2,dz1,dz2);
      if (m === dx1) pos.x = c.x1-PR;
      else if (m === dx2) pos.x = c.x2+PR;
      else if (m === dz1) pos.z = c.z1-PR;
      else pos.z = c.z2+PR;
    }
  }
  pos.x = THREE.MathUtils.clamp(pos.x, -7.8, 7.8);
  pos.z = THREE.MathUtils.clamp(pos.z, -5.8, 5.8);
}

let bob = 0;
function updatePlayer(dt){
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  let mx = 0, mz = 0;
  if (keys['w'] || keys['arrowup']) mz += 1;
  if (keys['s'] || keys['arrowdown']) mz -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  mx += joyVec.x; mz -= joyVec.y;
  const moving = Math.hypot(mx,mz) > 0.15 && !S.hiding;

  const running = keys['shift'] && moving && !S.sneak;
  if (running) profile.loudRuns += dt;
  const speed = running ? 3.35 : (S.sneak ? 1.05 : 2.05);

  if (moving){
    const dir = new THREE.Vector3().addScaledVector(forward, mz).addScaledVector(right, mx).normalize();
    player.position.addScaledVector(dir, speed*dt);
    bob += dt * (running ? 12 : 7.5);
    S.stepT += dt;
    const stepGap = running ? 0.3 : (S.sneak ? 0.62 : 0.46);
    if (S.stepT > stepGap){
      S.stepT = 0;
      playStep(S.sneak ? 0.035 : running ? 0.22 : 0.1, null, true);
      if (running){ S.awareness += 1.4; updateUnease(S.unease + 0.5); }
    }
  } else {
    bob += dt*2.2;
    S.stepT = 0;
  }

  // wake-up: camera rises from the bed
  if (S.wakeT < 2.6){
    S.wakeT += dt;
    const t = THREE.MathUtils.clamp(S.wakeT/2.6, 0, 1);
    const e = t*t*(3-2*t);
    camera.position.set(player.position.x, THREE.MathUtils.lerp(0.55, player.position.y, e), player.position.z);
    camera.rotation.set(THREE.MathUtils.lerp(0.72, pitch, e), yaw, THREE.MathUtils.lerp(0.12, 0, e), 'YXZ');
  } else {
    const bobY = moving ? Math.sin(bob)*0.026 : Math.sin(bob)*0.006;
    camera.position.set(player.position.x, player.position.y + bobY, player.position.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  collide(player.position);

  // awareness decays slowly when quiet
  S.awareness = Math.max(0, S.awareness - dt * (S.sneak ? 0.45 : 0.12));
  if (S.lightOn) S.awareness += dt * 0.5;

  // flashlight follows
  flash.position.copy(camera.position);
  flash.target.position.copy(camera.position).addScaledVector(forward, 6);
  flash.target.updateMatrixWorld();

  const r = roomAt(player.position.x, player.position.z);
  if (r !== S.room){ onRoomChange(S.room, r); S.room = r; }
  S.roomTimers[S.room] = (S.roomTimers[S.room]||0) + dt;
  profile.roomTime[S.room] = (profile.roomTime[S.room]||0) + dt;
  S.saveT = (S.saveT||0) + dt;
  if (S.saveT > 12){ S.saveT = 0; saveProfile(); }

  // hallway stretch
  if (S.room === 'hall') S.hallTime = (S.hallTime||0) + dt;
  if (!S.stretched && (S.hallTime||0) > 20 && S.phase >= 4) stretchHallway();

  // double: disappears when you look away
  if (S.doubleStage === 1 && doubleSeated.visible){
    const toD = new THREE.Vector3(doubleSeated.position.x-player.position.x, 0, doubleSeated.position.z-player.position.z).normalize();
    const f = new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(toD.dot(f),-1,1)));
    if (angle > 105) S.lookAwayT = (S.lookAwayT||0) + dt;
    else S.lookAwayT = 0;
    if ((S.lookAwayT||0) > 0.9){
      doubleSeated.visible = false;
      S.doubleStage = 1.5; S.lookAwayT = 0;
      subtitle('— you turn back. The sofa is empty. —');
      if (AC) playWhisper(null, 1.5);
      updateUnease(S.unease+10);
    }
  }
  if (S.doubleStage === 2 && doubleStanding.visible){
    // it turns its head to follow you, always
    faceXZ(doubleStanding, player.position.x, player.position.z);
  }
}

// ============================================================
//  EVENTS
// ============================================================
const ROOM_CENTERS = {
  bedroom:[-5.5,-3.0], bath:[-6.5,0.3], living:[-0.5,-3.4],
  kitchen:[5.8,-2.5], hall:[0,2.5], study:[6.0,4.7], copy:[-0.6,4.5]
};
function trustedRoom(){
  let best = null, bv = 0;
  for (const [r,v] of Object.entries(profile.roomTime || {})){
    if (v > bv){ bv = v; best = r; }
  }
  return best;
}
function ambientEvent(){
  const roll = Math.random();
  if (roll < 0.24){
    // 45%: it visits the room you keep returning to
    const trust = trustedRoom();
    if (trust && trust !== S.room && Math.random() < 0.45){
      const c = ROOM_CENTERS[trust];
      playKnock(new THREE.Vector3(c[0], 0, c[1]), 0.32);
      subtitle('— a knock from the room you trust most —');
    } else endOfHallManifest();
  }
  else if (roll < 0.44){ playKnock(new THREE.Vector3(player.position.x + (Math.random()-0.5)*7, 0, player.position.z + (Math.random()-0.5)*7), 0.3); }
  else if (roll < 0.6){ playWhisper(new THREE.Vector3(player.position.x + (Math.random()-0.5)*4, 0, player.position.z + (Math.random()-0.5)*4), 1.6); }
  else if (roll < 0.72){ playSilence(1.8); }
  else if (roll < 0.84){ playCreak(); subtitle('— the apartment settling. Probably. —'); }
  else if (roll < 0.93){ if (breath) { breath.gain.setTargetAtTime(0.02, AC.currentTime, 0.4); setTimeout(()=>{ if(breath) breath.gain.setTargetAtTime(0, AC.currentTime, 0.4); }, 5200); } subtitle('— breathing. In rhythm with yours. —'); }
  else { behindManifest(); }
}

let eventT = 0;
function updateEvents(dt){
  eventT += dt;
  const interval = THREE.MathUtils.lerp(34, 16, S.unease/100);
  if (eventT > interval){
    eventT = 0;
    if (Math.random() < 0.75) ambientEvent();
  }
  // awareness → presence
  if (S.awareness > 22 && Math.random() < dt*0.08){
    if (Math.random() < 0.5) endOfHallManifest(); else playKnock(null, 0.2);
    S.awareness *= 0.7;
  }
  if (S.awareness > 45 && !S.hiding && Math.random() < dt*0.05){
    S.awareness *= 0.75;
    if (S.room === 'hall') { stretchHallway(); }
  }
  // unease drift with time and room familiarity
  const familiarity = (S.roomTimers[S.room]||0);
  if (familiarity > 22){
    S.roomTimers[S.room] = 12;
    const trust = ['living','bedroom','kitchen','study','hall','bath'];
    mutateRoom(S.room);
    updateUnease(S.unease + 2.5);
    if (AC) playCreak();
  }
  updateUnease(S.unease + dt * 0.05);
}

// ============================================================
//  TELEVISION FEED
// ============================================================
let tvTimer = 0;
function updateTV(dt){
  if (!S.tvOn) return;
  tvTimer += dt;
  if (tvTimer < 0.2) return;
  tvTimer = 0;
  // impossible angle: ceiling corner behind the player
  const forward = new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
  const RB = {
    bedroom:[-7.6,-3.4,-5.6,-1.3], bath:[-7.7,-5.2,-0.8,1.2],
    living:[-2.7,3.2,-5.6,1.2], kitchen:[3.8,7.7,-5.6,1.2],
    hall:[-7.6,7.6,1.8,3.2], study:[3.8,7.7,3.8,5.7],
    copy:[-2.7,3.2,3.8,5.7]
  };
  const b = RB[S.room] || RB.living;
  const camPos = player.position.clone().addScaledVector(forward, 2.4);
  camPos.x = THREE.MathUtils.clamp(camPos.x, b[0], b[1]);
  camPos.z = THREE.MathUtils.clamp(camPos.z, b[2], b[3]);
  camPos.y = 2.55;
  tvCam.position.copy(camPos);
  tvCam.lookAt(player.position.x, 1.05, player.position.z);
  const vis = [tvMain.g, tvCopy.g];
  const mv = vis.map(m=>m.visible);
  vis.forEach(m=>m.visible=false);
  const mirrorVis = mirrorMesh ? mirrorMesh.visible : false;
  if (mirrorMesh) mirrorMesh.visible = false;
  renderer.setRenderTarget(tvRT);
  renderer.render(scene, tvCam);
  renderer.setRenderTarget(null);
  vis.forEach((m,i)=>m.visible=mv[i]);
  if (mirrorMesh) mirrorMesh.visible = mirrorVis;
  tvScreenMat.map = tvRT.texture;
  tvScreenMat.needsUpdate = true;
}

// ============================================================
//  ENDINGS
// ============================================================
function endGame(kind){
  if (S.ended) return;
  S.ended = true;
  profile.endings[kind] = true; saveProfile();
  document.exitPointerLock && document.exitPointerLock();
  document.getElementById('hud').style.display = 'none';
  phoneEl.style.display = 'none';
  const screen = document.getElementById('endingScreen');
  const title = document.getElementById('endingTitle');
  const text = document.getElementById('endingText');
  const stats = document.getElementById('endingStats');
  const truthCount = Object.values(S.truth).filter(Boolean).length;
  if (kind === 'escape'){
    title.textContent = 'ENDING I — YOU LEFT';
    text.textContent = `The deadbolt gives. The door opens onto your hallway, which is exactly as it should be.\n\nYou take the stairs. You do not look back. Your phone buzzes once, in your pocket:\n\n“You left the door open. I am standing in your kitchen. I am wearing your face. I will wait for you to come home.”\n\nYou escape the apartment. You do not escape the feeling that the next door you open will be this one again.`;
  } else if (kind === 'replacement'){
    title.textContent = 'ENDING II — REPLACEMENT';
    text.textContent = `You sit down. The cushion gives under you like it has been waiting.\n\nThe television is very bright. You cannot turn your head. Somewhere behind you, someone stands up, stretches, and walks to the kitchen for the spare key.\n\nYou want to shout: don't turn around. But your mouth is full of someone else's breathing.\n\nTomorrow at 3:17, the new tenant will wake up here and receive a message from their own number. It will say: don't turn around.`;
  } else {
    title.textContent = 'ENDING III — THE TRUTH, SUCH AS IT IS';
    text.textContent = `The diary, the photograph, the tape. Three proofs that the apartment repeats, and that you are part of the repetition.\n\nThe mirror finally stops lagging. In it, the sofa is empty. In it, you are standing alone. That is the disturbing part: you cannot tell whether the mirror has corrected itself, or whether you are the reflection now.\n\nThe Tenant was never a monster. It is the apartment's memory of everyone who checked behind them one night too many.\n\nYou understand it. It explains almost everything. It does not make you feel any less watched.`;
  }
  stats.textContent = `Unease ${Math.round(S.unease)} · Behind-checks ${profile.glances} · Hides ${Object.values(profile.hides).reduce((a,b)=>a+b,0)} · Proof ${truthCount}/3 · Night ${profile.runs}`;
  screen.style.display = 'flex';
  if (AC) playSilence(4);
}

// ============================================================
//  LOOP
// ============================================================
let running = true;
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (S.started && !S.ended && !S.paused){
    updatePlayer(dt);
    updateTV(dt);
    updateEvents(dt);
    updateInteract();
    updateHeartbeat(dt);
    if (mirrorMesh) mirrorMesh.visible = player.position.distanceTo(new THREE.Vector3(-7.9,1.5,0.55)) < 8.5;
    if (S.tvOn){
      tvGlow.intensity = 1.6 + Math.sin(performance.now()*0.006)*0.35;
      tvGlow.color.setHex(Math.random()<0.5?0x8fb4ff:0xa8c4ff);
    } else tvGlow.intensity = 0;
    if (window.__dust){
      window.__dust.rotation.y += dt*0.006;
      const p = window.__dust.geometry.attributes.position;
      for (let i=0;i<p.count;i++){
        p.array[i*3+1] += Math.sin(performance.now()*0.0003 + i)*dt*0.02;
      }
      p.needsUpdate = true;
    }
    // flashlight flicker
    if (S.lightOn){
      flash.intensity = 26 + (Math.random()<0.015 ? -16 : 0);
    }
  }
  renderer.render(scene, camera);
}
animate();

// ============================================================
//  START / PAUSE
// ============================================================
function showPause(){
  if (S.ended) return;
  S.paused = true;
  document.getElementById('pauseScreen').style.display = 'flex';
  document.exitPointerLock && document.exitPointerLock();
}
function hidePause(){
  S.paused = false;
  document.getElementById('pauseScreen').style.display = 'none';
  suppressPauseUntil = Date.now()+400;
  lockPointer();
}
document.getElementById('resumeBtn').onclick = hidePause;
document.getElementById('restartBtn2').onclick = ()=>location.reload();
document.getElementById('againBtn').onclick = ()=>location.reload();

document.getElementById('beginBtn').onclick = ()=>{
  initAudio();
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  const wake = document.getElementById('wake');
  wake.style.display = 'block';
  wake.offsetHeight; // force the black frame to exist before the fade
  wake.style.opacity = '0';
  setTimeout(()=>{ wake.style.display='none'; }, 3200);
  S.started = true; S.wakeT = 0;
  updateInventory(); updateUnease(6); setObjective(0);
  S.room = roomAt(player.position.x, player.position.z);
  if (AC) playCreak();
  setTimeout(()=>{
    addMsg('them', "Don't turn around. I'm trying to keep it away from you.");
    playKnock(new THREE.Vector3(-5,0,-2), 0.3);
    toast('3:17 AM. Your phone is lit. [TAB] to read it.');
  }, 3400);
  setTimeout(()=>{ if (S.phase < 1) subtitle('— the dresser by the window. Something is on it. —'); }, 9000);
  suppressPauseUntil = Date.now()+900;
  setTimeout(lockPointer, 60);
};
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('beforeunload', saveProfile);
window.addEventListener('blur', ()=>{ if (S.started && !S.ended && !phoneOpen && !S.paused) showPause(); });

const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.style.display = 'none';

// debug/testing hook (harmless: no gameplay effect)
window.__game = {
  S, player, camera, scene, THREE,
  figures:{ tenant, doubleSeated, doubleStanding, mirrorFigure },
  pose(x, z, y2, p2){ player.position.set(x, 1.62, z); yaw = y2; pitch = p2; S.wakeT = 99; },
  reveal(){ revealCopyRoom(); },
  power(){ actions.breaker(); },
  key(){ actions.key(); },
  torch(){ actions.torch(); },
  double(stage){ triggerDouble(stage); },
  truth(){ S.truth.diary=S.truth.photo=S.truth.tape=true; updateInventory(); checkProofs(); },
  end(k){ endGame(k); },
  step(n=60){ for (let i=0;i<n;i++){ updatePlayer(0.05); updateTV(0.05); updateEvents(0.05); } }
};
