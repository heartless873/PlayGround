import * as THREE from 'three';

// ============ PERSISTENT LEARNING PROFILE ============
const PROFILE_KEY = 'ywna_profile_v1';
let profile = { glances:0, checkCount:0, hides:{}, roomTime:{}, runs:0, endingsSeen:{}, caught:0, mirrorLooks:0, lightTime:0, runTime:0, tvWatches:0 };
try { const s = localStorage.getItem(PROFILE_KEY); if (s) profile = {...profile, ...JSON.parse(s)}; } catch(e){}
function saveProfile(){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }catch(e){} }
profile.runs++; saveProfile();

// ============ STATE ============
const S = {
  started:false, paused:false, ended:false,
  phase:0, // 0 wake, 1 torch, 2 explore, 3 key, 4 power, 5 tv/copy, 6 double, 7 choice
  hasTorch:false, hasKey:false, hasTape:false, power:false, tvOn:false,
  evidence:0, hiding:null, lightOn:false, sneak:false, running:false,
  unease:0, tenantState:'dormant', tenantAwareness:0,
  switches:{}, doors:{}, photosChanged:0, copySeen:false, doublePhase:0, mirrorTruth:false,
  lookYaw:0, lastYawDelta:0, yawHistory:[], behindCheckCooldown:0,
  roomNow:'bedroom', roomTimers:{}, lastEvent:0, knockCount:0, whisperCount:0,
  startTime:Date.now(), footstepsBehind:0, tenantVisible:0,
  notesRead:0
};
const OBJECTIVES = [
  "Wake up. Find something to see with — check the dresser in your bedroom.",
  "Find your phone. Read the message. Then explore the apartment.",
  "The front door is locked from the inside. Find the spare key — usually in the kitchen.",
  "The deadbolt is electronic. Power is out. Restore the breaker — check the study.",
  "The TV turned on by itself. Look at it. Then find where that room is.",
  "Find the identical living room. Don't sit down. Don't turn your back.",
  "Hide the evidence of the loop — gather 3 truths: diary, photograph, tape. The mirror remembers.",
  "Choose: ESCAPE (front door) · STAY (the sofa) · CONFRONT (the mirror)."
];
function setObjective(i){ S.phase=Math.max(S.phase,i); document.getElementById('objText').textContent = OBJECTIVES[i] || OBJECTIVES[OBJECTIVES.length-1]; }
function updateUnease(v){ S.unease = THREE.MathUtils.clamp(v,0,100); document.getElementById('uneaseFill').style.width = S.unease+'%'; document.getElementById('fear').style.opacity = (S.unease/100*0.55).toFixed(2); }

// ============ AUDIO ============
let AC=null, masterGain=null, ambGain=null, breathGain=null;
function initAudio(){
  if (AC) return;
  try {
    AC = new (window.AudioContext||window.webkitAudioContext)();
    masterGain = AC.createGain(); masterGain.gain.value=0.9; masterGain.connect(AC.destination);
    ambGain = AC.createGain(); ambGain.gain.value=0.05; ambGain.connect(masterGain);
    // low hum
    const o=AC.createOscillator(); o.frequency.value=50; const g=AC.createGain(); g.gain.value=0.4; o.connect(g); g.connect(ambGain); o.start();
    const o2=AC.createOscillator(); o2.frequency.value=120; const g2=AC.createGain(); g2.gain.value=0.08; o2.connect(g2); g2.connect(ambGain); o2.start();
    // breathing loop
    const buf=noiseBuffer(2); const src=AC.createBufferSource(); src.buffer=buf; src.loop=true;
    const f=AC.createBiquadFilter(); f.type='bandpass'; f.frequency.value=600; f.Q.value=1.2;
    breathGain=AC.createGain(); breathGain.gain.value=0;
    src.connect(f); f.connect(breathGain); breathGain.connect(masterGain); src.start();
    const lfo=AC.createOscillator(); lfo.frequency.value=0.22; const lg=AC.createGain(); lg.gain.value=0.006; lfo.connect(lg); lg.connect(breathGain.gain); lfo.start();
  }catch(e){}
}
function noiseBuffer(dur){
  const b=AC.createBuffer(1, AC.sampleRate*dur, AC.sampleRate); const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b;
}
function panFor(pos){
  if(!AC) return 0;
  const v=new THREE.Vector3(pos.x-player.position.x,0,pos.z-player.position.z);
  const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)); // approx
  return THREE.MathUtils.clamp(v.dot(right)/(v.length()+0.001),-1,1);
}
function playKnock(pos, vol=0.5){
  if(!AC) return;
  const t=AC.currentTime; const o=AC.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(180,t); o.frequency.exponentialRampToValueAtTime(70,t+0.12);
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.25);
  const p=AC.createStereoPanner?AC.createStereoPanner():null;
  o.connect(g); if(p){p.pan.value=pos?panFor(pos):0; g.connect(p); p.connect(masterGain);} else g.connect(masterGain);
  o.start(t); o.stop(t+0.3); S.knockCount++;
}
function playStep(vol=0.2, tenant=false, pos=null){
  if(!AC) return;
  const t=AC.currentTime; const src=AC.createBufferSource(); src.buffer=noiseBuffer(0.12);
  const f=AC.createBiquadFilter(); f.type='lowpass'; f.frequency.value= tenant?900:500;
  const g=AC.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
  const p=AC.createStereoPanner?AC.createStereoPanner():null;
  src.connect(f); f.connect(g); if(p){ let pan=0; if(pos) pan=panFor(pos); if(tenant && !pos) pan=0.4; p.pan.value=pan; g.connect(p); p.connect(masterGain);} else g.connect(masterGain);
  src.start(t); src.stop(t+0.15);
}
function playWhisper(pos=null, dur=1.6){
  if(!AC) return;
  const t=AC.currentTime; const src=AC.createBufferSource(); src.buffer=noiseBuffer(dur);
  const f=AC.createBiquadFilter(); f.type='bandpass'; f.Q.value=4;
  f.frequency.setValueAtTime(800,t); f.frequency.linearRampToValueAtTime(2200,t+dur*0.5); f.frequency.linearRampToValueAtTime(600,t+dur);
  const g=AC.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.18,t+dur*0.3); g.gain.linearRampToValueAtTime(0,t+dur);
  const p=AC.createStereoPanner?AC.createStereoPanner():null;
  src.connect(f); f.connect(g); if(p){p.pan.value=pos?panFor(pos):0; g.connect(p); p.connect(masterGain);} else g.connect(masterGain);
  src.start(t); src.stop(t+dur+0.1); S.whisperCount++;
  showSubtitle(pos? "— a familiar voice, from an empty room —" : "— someone breathing with you —");
}
function playCreak(){
  if(!AC) return;
  const t=AC.currentTime; const o=AC.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(90,t); o.frequency.linearRampToValueAtTime(60,t+0.7);
  const g=AC.createGain(); g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.8);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t+0.9);
}
function playThud(){
  if(!AC) return;
  const t=AC.currentTime; const o=AC.createOscillator(); o.frequency.setValueAtTime(55,t); o.frequency.exponentialRampToValueAtTime(30,t+0.4);
  const g=AC.createGain(); g.gain.setValueAtTime(0.6,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t+0.6);
}
function playSilence(dur=2.2){
  if(!AC||!ambGain) return;
  const t=AC.currentTime; ambGain.gain.setValueAtTime(ambGain.gain.value,t); ambGain.gain.linearRampToValueAtTime(0.0001,t+0.2);
  setTimeout(()=>{ if(ambGain) ambGain.gain.linearRampToValueAtTime(0.05, AC.currentTime+0.8); }, dur*1000);
  showSubtitle("— the apartment forgets how to make sound —");
}
function playTVStatic(){
  if(!AC) return;
  const t=AC.currentTime; const src=AC.createBufferSource(); src.buffer=noiseBuffer(1.2);
  const g=AC.createGain(); g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+1.2);
  src.connect(g); g.connect(masterGain); src.start(t); src.stop(t+1.3);
}

// ============ THREE SETUP ============
const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x050505); scene.fog=new THREE.Fog(0x050505,2,22);
const camera=new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.05, 60);
const player={ position:new THREE.Vector3(-7.2,1.6,-3.8), vel:new THREE.Vector3(), yaw:-0.55, pitch:-0.05, sneak:false };
let yaw=player.yaw, pitch=player.pitch;
const clock=new THREE.Clock();

// lights
const ambient=new THREE.AmbientLight(0x33333a, 1.1); scene.add(ambient);
const flash=new THREE.SpotLight(0xfff2d0, 0, 18, 0.55, 0.4, 1); flash.castShadow=true; flash.shadow.mapSize.set(1024,1024); scene.add(flash); scene.add(flash.target);
const roomLights=[];
function addRoomLight(x,z,color=0xffe8c0,intensity=1.4){
  const l=new THREE.PointLight(color,intensity,10,1.2); l.position.set(x,2.4,z); l.castShadow=true; scene.add(l); roomLights.push(l); return l;
}
addRoomLight(-7,-4.5); addRoomLight(0,-3,0xffe8c0,1.1); addRoomLight(7,-4,0xfff0d0,1.0); addRoomLight(0,2,0xdde4ff,0.9); addRoomLight(7,1,0xffe8c0,0.9); addRoomLight(-8,0,0xdde4ff,0.8); addRoomLight(0,5,0xffe8c0,0.8);

// materials
const MAT={
  wall:new THREE.MeshStandardMaterial({color:0x9a9186, roughness:0.95}),
  wall2:new THREE.MeshStandardMaterial({color:0x7d766c, roughness:0.95}),
  floor:new THREE.MeshStandardMaterial({color:0x5a4230, roughness:0.8}),
  ceil:new THREE.MeshStandardMaterial({color:0xc8c4bb, roughness:1}),
  dark:new THREE.MeshStandardMaterial({color:0x141414, roughness:1}),
  wood:new THREE.MeshStandardMaterial({color:0x4a3421, roughness:0.85}),
  fabric:new THREE.MeshStandardMaterial({color:0x3a4a5a, roughness:1}),
  fabric2:new THREE.MeshStandardMaterial({color:0x6a2020, roughness:1}),
  metal:new THREE.MeshStandardMaterial({color:0x888888, roughness:0.4, metalness:0.6}),
  paper:new THREE.MeshStandardMaterial({color:0xddd6c0, roughness:1}),
  mirror:new THREE.MeshStandardMaterial({color:0xaac4cc, roughness:0.1, metalness:0.9}),
};
function box(x,y,z,w,h,d,mat,parent=scene){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
const colliders=[]; // {x1,x2,z1,z2}
function addCollider(x,z,w,d){ colliders.push({x1:x-w/2,x2:x+w/2,z1:z-d/2,z2:z+d/2}); }
function wall(x,z,w,d,h=2.8,mat=MAT.wall){
  const m=box(x,h/2,z,w,h,d,mat); m.receiveShadow=true; addCollider(x,z,w,d); return m;
}

// floors / ceilings
const floor=box(0, -0.05, 0, 21, 0.1, 15, MAT.floor); floor.receiveShadow=true;
box(0,2.85,0,21,0.1,15,MAT.ceil);

// outer walls
wall(0,-7,21,0.3); wall(0,7,21,0.3); wall(-10.5,0,0.3,15); wall(10.5,0,0.3,15);

// interior partitions with door gaps
// bedroom east wall x=-4, gap z -4.2..-2.8 (door at z=-3.5)
wall(-4,-5.5,0.25,3.0); wall(-4,-1.4,0.25,1.8);
// living/kitchen divider x=4 gap z -3.2..-1.8
wall(4,-5.5,0.25,3.0); wall(4,-1.2,0.25,1.5);
// hallway north wall z=1, gaps for living (x -3..-1), kitchen door at x=4, study at x=7
wall(-5,1,6,0.25); wall(3.5,1,4.5,0.25); wall(8.5,1,3.5,0.25); wall(0.5,1,3.5,0.25);
// hallway south wall z=3, hidden-copy door at x=0 initially closed wall
wall(-4,3,5.5,0.25); wall(4,3,5.5,0.25);
const hiddenDoorWall=wall(0,3,2.5,0.25,2.8,MAT.wall2); hiddenDoorWall.userData.id='hiddenDoor';
// bathroom east wall x=-6, gap z 1..3 (bathroom x -10..-6, z -2..3)
wall(-6,-0.5,0.25,3.0); wall(-6,2,0.25,2.0);
// study divider x=7 gap z -0.5..1.5
wall(7,-3.5,0.25,5.0); wall(7,3,0.25,5.0);
// bedroom south wall (open-plan visual, z=-1.5 across bedroom)
wall(-7,-1.5,6,0.25);

// furniture
function furniture(){
  // bedroom
  box(-8.5,0.4,-6.2,1.9,0.5,2.2,MAT.wood); box(-8.5,0.9,-6.2,1.9,0.15,2.2,MAT.fabric); box(-9.7,0.8,-6.2,0.15,1.1,2.2,MAT.wood);
  box(-5.2,0.9,-6.6,1.8,1.4,0.4,MAT.wood); // dresser
  // closet = hide1 interactable (registered later)
  // living
  box(0,0.45,-5,3.2,0.5,1.0,MAT.fabric); box(-1.6,0.9,-5.4,1.0,1.0,0.3,MAT.fabric); box(1.6,0.9,-5.4,1.0,1.0,0.3,MAT.fabric);
  box(0,0.35,-3.8,1.6,0.4,0.8,MAT.wood);
  box(0,1.0,-6.85,2.4,1.8,0.15,MAT.dark);
  box(0,0.5,-6.6,0.4,0.4,0.5,MAT.metal);
  // kitchen
  box(9.5,0.9,-6.5,1.2,0.9,2.4,MAT.wood); box(9.2,0.9,-3,1.8,0.9,0.6,MAT.wood); box(6,0.9,-6.8,2.0,0.9,0.6,MAT.wood);
  // study
  box(9.5,0.9,2.5,1.2,0.9,1.6,MAT.wood); box(9.9,1.0,4.5,0.2,2.0,1.2,MAT.wood);
  // copy living (south)
  box(0,0.45,5.5,3.2,0.5,1.0,MAT.fabric); box(-1.6,0.9,5.1,1.0,1.0,0.3,MAT.fabric); box(1.6,0.9,5.1,1.0,1.0,0.3,MAT.fabric);
  box(0,1.0,6.85,2.4,1.8,0.15,MAT.dark);
}
furniture();

// doors (interactive, rotate)
const doors=[];
function makeDoor(id,x,z,ry,width=1.0){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry; scene.add(g);
  const m=box(0,1.1,0,width,2.2,0.08,MAT.wood,g); m.userData={interact:true,id,label:'Open door'};
  // Actually collider handled separately: add door collider removed when open
  // door group is rotated ry; door leaf spans local X. world collider must match facing.
  const isNS = Math.abs(Math.cos(ry))>0.5; // door plane faces along Z (ry=0 or PI) -> narrow X, long Z
  let col;
  if(isNS){ col={x1:x-0.2,x2:x+0.2,z1:z-width/2-0.1,z2:z+width/2+0.1,temp:true}; }
  else { col={x1:x-width/2-0.1,x2:x+width/2+0.1,z1:z-0.2,z2:z+0.2,temp:true}; }
  colliders.push(col);
  const d={id,group:g,open:false,col,baseY:ry};
  doors.push(d); return d;
}
makeDoor('bedroomDoor',-4,-3.5,0);
makeDoor('bathDoor',-6,0,Math.PI/2);
makeDoor('livingDoor',-1,1,0);
makeDoor('kitchenDoor',6.6,1,0);
makeDoor('studyDoor',7,2,Math.PI/2);

// front door (east end hallway)
const frontDoorGroup=new THREE.Group(); frontDoorGroup.position.set(10.2,0,2); scene.add(frontDoorGroup);
const frontDoorMesh=box(0,1.1,0,0.1,2.2,1.1,MAT.wood,frontDoorGroup); frontDoorMesh.userData={interact:true,id:'frontDoor',label:'Front door — locked'};
const frontCol={x1:9.9,x2:10.5,z1:1.4,z2:2.6}; colliders.push(frontCol);

// TV with live view
const tvCanvas=document.createElement('canvas'); tvCanvas.width=512; tvCanvas.height=288;
const tvTex=new THREE.CanvasTexture(tvCanvas);
const tvMat=new THREE.MeshBasicMaterial({map:tvTex});
const tvMesh=box(0,1.15,-6.85,2.4,1.35,0.08,tvMat); tvMesh.userData={interact:true,id:'tv',label:'Television'};
const tvRT=new THREE.WebGLRenderTarget(512,288);
const tvCam=new THREE.PerspectiveCamera(50,16/9,0.1,30);
// copy TV
const tv2Mesh=box(0,1.15,6.85,2.4,1.35,0.08,tvMat); tv2Mesh.userData={interact:true,id:'tv',label:'Television'};

// photos (canvas textures)
function photoTexture(lines){ const c=document.createElement('canvas'); c.width=256;c.height=320; const x=c.getContext('2d'); x.fillStyle='#221c14';x.fillRect(0,0,256,320); x.fillStyle='#cbbfa5'; x.font='bold 20px serif'; lines.forEach((l,i)=>x.fillText(l,20,60+i*30)); x.strokeStyle='#000'; x.strokeRect(5,5,246,310); return new THREE.CanvasTexture(c); }
const photoStates=[
  (i)=>photoTexture(["A FAMILY","PORTRAIT","1998","— we smile —"]),
  (i)=>photoTexture(["A FAMILY","PORTRAIT","1998","— nobody left —"])
];
const photoMeshes=[];
function addPhoto(x,z,ry){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.8), new THREE.MeshBasicMaterial({map:photoStates[0](0)}));
  m.position.set(x,1.6,z); m.rotation.y=ry; m.userData={interact:true,id:'photo',label:'Photograph — look closer'}; scene.add(m); photoMeshes.push(m);
  // frame
  box(x+(ry?0.02:0),1.6,z+(ry?0:0.02), Math.abs(ry)>1?0.05:0.66,0.86,Math.abs(ry)>1?0.66:0.05,MAT.wood);
}
addPhoto(-4.12,-4.5,Math.PI/2); addPhoto(0,-6.95,0); addPhoto(9.9,-4, -Math.PI/2);

// mirror (bathroom + hallway)
const mirrorMat=new THREE.MeshStandardMaterial({color:0xb8d0d8, roughness:0.05, metalness:1});
const mirrorMesh=new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.8), mirrorMat);
mirrorMesh.position.set(-10.3,1.4,0); mirrorMesh.rotation.y=Math.PI/2; mirrorMesh.userData={interact:true,id:'mirror',label:'Mirror — don\'t stare too long'}; scene.add(mirrorMesh);

// interactables list
const interactables=[];
function reg(obj,id,label,fn){ obj.userData={interact:true,id,label,fn}; interactables.push(obj); }
// dresser torch
const torchMesh=box(-5.2,1.75,-6.3,0.25,0.12,0.25,new THREE.MeshStandardMaterial({color:0x222222,emissive:0x332200})); reg(torchMesh,'torch','Take flashlight',()=>{ S.hasTorch=true; torchMesh.visible=false; toast('Flashlight — [F] to switch on. It will attract attention.'); addMsg('me','Where did the flashlight go? I don\'t remember putting it there.'); setObjective(1); setTimeout(()=>queuePhone(1),3000); });
// phone on bedside
const phoneMesh=box(-9.9,0.7,-5,0.12,0.05,0.25,new THREE.MeshStandardMaterial({color:0x111111,emissive:0x111133})); reg(phoneMesh,'phoneMesh','Look at phone [TAB]',()=>togglePhone(true));
// kitchen key drawer
const drawerMesh=box(9.2,0.95,-3,1.8,0.2,0.7,MAT.wood); reg(drawerMesh,'key','Search kitchen drawer',()=>{
  if(!S.hasKey){ S.hasKey=true; toast('Found: spare key. It feels warm.'); addMsg('them','You found it. Good. Now don\'t use it yet — let the lights come back first.'); setObjective(3); }
  else toast('Empty. Something was already here.');
});
const drawer2=box(6,0.95,-6.8,2.0,0.2,0.7,MAT.wood); drawer2.userData={interact:true,id:'drawer2',label:'Search drawer'}; reg(drawer2,'drawer2','Search drawer',()=>{ toast(S.power?'Dust and old batteries.':'A burned fuse. The breaker needs a new one. Check the study desk.'); if(!S.power) setObjective(3); });
// diary bedroom
const diaryMesh=box(-9.8,0.85,-6.2,0.4,0.08,0.5,new THREE.MeshStandardMaterial({color:0x3a1010})); reg(diaryMesh,'diary','Read diary',()=>{
  toast('Diary, your handwriting: “Day 41. It sits on my sofa. I have proof now.”');
  S.evidenceMark={...(S.evidenceMark||{}),diary:true}; updateEvidenceUI();
  setTimeout(()=>addMsg('them','That diary isn\'t yours. But you wrote it anyway. Keep going.'),2000);
});
// breaker study
const breakerMesh=box(9.9,1.4,0.2,0.15,0.8,0.6,new THREE.MeshStandardMaterial({color:0x555555})); reg(breakerMesh,'breaker','Flip breaker',()=>{
  if(!S.power){ S.power=true; roomLights.forEach(l=>l.intensity*=1.8); toast('Power hums back. Somewhere, a television wakes.'); setObjective(4); queuePhone(3); setTimeout(()=>{ S.tvOn=true; playTVStatic(); powerOnTV(); },4000); }
  else toast('Breaker is on. Flipping it off feels like an invitation.');
});
// tape on TV stand (truth evidence)
const tapeMesh=box(0.7,0.55,-6.6,0.35,0.05,0.25,new THREE.MeshStandardMaterial({color:0x111111})); reg(tapeMesh,'tape','Take VHS tape',()=>{
  if(!S.hasTape){ S.hasTape=true; S.evidence=(S.evidenceMark&&S.evidenceMark.tape)?S.evidence:2; S.evidenceMark={...(S.evidenceMark||{}),tape:true}; toast('VHS: “DO NOT PLAY — 3:17 AM”. Watch it on the TV to get the truth.'); updateEvidenceUI(); }
  else toast('The tape case is empty now.');
});
// notes
const note1=box(-5.2,1.75,-6.55,0.4,0.3,0.02,MAT.paper); note1.rotation.z=0.1; reg(note1,'note','Read note on dresser',()=>{ toast('Note: “If you find the other living room, don\'t sit on the sofa. — you”'); S.notesRead++; });
const note2=box(9.5,1.35,2,0.4,0.3,0.02,MAT.paper); note2.rotation.z=-0.1; reg(note2,'note2','Read study note',()=>{ toast('Study note: “He checks behind him at 3:17. Use that.”'); S.notesRead++; });
const note3=box(0,1.35,-6.6,0.4,0.3,0.02,MAT.paper); reg(note3,'note3','Read note by TV',()=>{ toast('Sticky note: “The TV shows the room you\'re not in. That\'s how you know.”'); });

function updateEvidenceUI(){ const el=document.getElementById('invList'); el.innerHTML=`${S.hasTorch?'🔦 Flashlight [F]':'— no light —'}<br>${S.hasKey?'🔑 Spare key':'— no key —'}${S.hasTape?'<br>📼 VHS tape':''}<br>Truth found: ${Object.keys(S.evidenceMark||{}).length}/3`; }

// ==== TENANT ====
function buildTenant(){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x0a0a0a, roughness:1});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.22,1.1,4,8),mat); body.scale.set(0.85,1.25,0.7); body.position.y=0.95; g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.14,12,10),mat); head.scale.set(0.8,1.35,0.85); head.position.y=1.85; g.add(head);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.08,0.3),mat); neck.position.y=1.65; g.add(neck);
  const armL=new THREE.Mesh(new THREE.CapsuleGeometry(0.05,0.9),mat); armL.position.set(-0.32,1.05,0); armL.rotation.z=0.15; g.add(armL);
  const armR=armL.clone(); armR.position.x=0.32; armR.rotation.z=-0.15; g.add(armR);
  const legL=new THREE.Mesh(new THREE.CapsuleGeometry(0.07,0.7),mat); legL.position.set(-0.12,0.25,0); g.add(legL);
  const legR=legL.clone(); legR.position.x=0.12; g.add(legR);
  // eyes faint
  const eyeMat=new THREE.MeshBasicMaterial({color:0xdddddd});
  const e1=new THREE.Mesh(new THREE.SphereGeometry(0.015),eyeMat); e1.position.set(-0.05,1.88,0.11); g.add(e1);
  const e2=e1.clone(); e2.position.x=0.05; g.add(e2);
  g.visible=false; g.userData.baseY=1.85;
  return g;
}
const tenant=buildTenant(); scene.add(tenant);
const tenantState={ pos:new THREE.Vector3(0,0,5.5), mode:'hidden', timer:0, speed:0.6, target:null, echoOffset:0 };
function tenantGoto(x,z){ tenantState.target=new THREE.Vector3(x,0,z); }
function tenantShow(mode,dur=3){ tenant.visible=true; tenantState.mode=mode; tenantState.timer=dur; S.tenantVisible+=dur; playThud(); updateUnease(S.unease+8); }

// double (iconic scene)
const doubleMesh=buildTenant(); doubleMesh.visible=false; doubleMesh.position.set(0,0,5.5); scene.add(doubleMesh);
// make double look like player (lighter)
doubleMesh.children.forEach(c=>{ if(c.material && c.material.color) c.material=new THREE.MeshStandardMaterial({color:0x2a2f3a,roughness:0.9}); });
doubleMesh.rotation.y=Math.PI; // facing away (north, toward hallway when in copy room)

// reflection tenant in mirror
const mirrorTenant=buildTenant(); mirrorTenant.visible=false; scene.add(mirrorTenant);

// ============ PHONE ============
const phoneEl=document.getElementById('phone'), msgsEl=document.getElementById('msgs'), badge=document.getElementById('phoneBadge');
let phoneOpen=false;
function addMsg(who,text){
  const d=document.createElement('div'); d.className='msg'+(who==='me'?' me':''); 
  const t=new Date(); const tomorrow=true;
  d.innerHTML=`${text}<span class="t">${who==='me'?'YOU':"YOUR CONTACT"} · 3:17 AM · tomorrow</span>`;
  msgsEl.appendChild(d); msgsEl.scrollTop=msgsEl.scrollHeight;
  if(!phoneOpen){ badge.style.display='flex'; badge.classList.add('has'); }
}
function queuePhone(n){
  const scripts={
    1:["Don't turn around. I'm trying to keep it away from you."],
    2:["You check behind you "+profile.glances+" times. It's noticed."],
    3:["Power's back. Watch the TV. Don't go where it shows you — unless you want the truth."],
    4:["It learns your hiding places. Don't hide twice in the same closet."],
    5:["It sits facing away. When you turn around, it will be gone. Stand facing it. Breathe."],
    6:["The hallway got longer. That's not you. Keep walking."],
    7:["You have all three truths. The mirror is the last door. Or the front door. Choose."],
  };
  (scripts[n]||[]).forEach((s,i)=>setTimeout(()=>addMsg('them',s), i*2500));
}
function togglePhone(force){
  phoneOpen = force!==undefined?force:!phoneOpen;
  phoneEl.style.display=phoneOpen?'flex':'none';
  if(phoneOpen){ badge.style.display='none'; badge.classList.remove('has'); suppressPauseUntil=Date.now()+400; document.exitPointerLock&&document.exitPointerLock(); }
  else if(S.started && !S.ended){ lockPointer(); }
}
document.getElementById('phoneClose').onclick=()=>togglePhone(false);
badge.onclick=()=>togglePhone(true);

// ============ UI helpers ============
let toastTimer=null;
function toast(txt,dur=3500){ const t=document.getElementById('toast'); t.textContent=txt; t.style.display='block'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.style.display='none',dur); }
let subTimer=null;
function showSubtitle(txt,dur=3000){ const s=document.getElementById('subtitle'); s.textContent=txt; clearTimeout(subTimer); subTimer=setTimeout(()=>s.textContent='',dur); }
function powerOnTV(){ /* TV canvas will show live view */ }

// ============ INPUT ============
const keys={};
addEventListener('keydown',e=>{
  keys[e.key.toLowerCase()]=true;
  if(e.key==='Tab'){ e.preventDefault(); if(S.started) togglePhone(); }
  if(e.key.toLowerCase()==='f' && S.hasTorch){ S.lightOn=!S.lightOn; flash.intensity=S.lightOn?2.2:0; toast(S.lightOn?'Flashlight on.':'Flashlight off.'); if(S.lightOn) S.tenantAwareness=Math.max(0,S.tenantAwareness-2); else S.tenantAwareness+=2; }
  if(e.key.toLowerCase()==='e'){ tryInteract(); }
  if(e.key.toLowerCase()==='c'){ S.sneak=!S.sneak; toast(S.sneak?'Sneaking — quiet.':'Standing.'); }
  if(e.key==='Escape' && S.started && !S.ended && !phoneOpen){ showPause(); }
});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
addEventListener('mousemove',e=>{
  if(document.pointerLockElement!==canvas) return;
  const dx=e.movementX, dy=e.movementY;
  const prevYaw=yaw;
  yaw-=dx*0.0022; pitch-=dy*0.0022; pitch=THREE.MathUtils.clamp(pitch,-1.4,1.4);
  const delta=Math.abs(((yaw-prevYaw)*180/Math.PI+540)%360-180);
  // behind-check detection: fast large yaw
  if(delta>95 && Date.now()-S.behindCheckCooldown>1500){
    S.behindCheckCooldown=Date.now(); profile.glances++; profile.checkCount++; saveProfile();
    S.tenantAwareness+=3; updateUnease(S.unease+3);
    showSubtitle('— you checked behind you —');
    if(profile.glances===3) setTimeout(()=>{ addMsg('them',"You check behind you a lot. It likes that. I'm losing it."); playWhisper(new THREE.Vector3(player.position.x-1,0,player.position.z-1)); },1500);
    if(profile.glances===6) setTimeout(()=>{ triggerBehindManifest(); },1200);
    if(profile.glances>=9 && profile.glances%3===0) setTimeout(()=>triggerBehindManifest(),800);
  }
  S.lastYawDelta=delta;
});
function lockPointer(){ try{ const r=canvas.requestPointerLock()||Promise.resolve(); r.catch?.(()=>{}); }catch(e){} }
let suppressPauseUntil=0;
document.addEventListener('pointerlockchange',()=>{
  if(!document.pointerLockElement && S.started && !S.ended && !phoneOpen && !S.paused){
    if(Date.now()<suppressPauseUntil) return;
    showPause();
  }
});

// touch
let joyVec={x:0,y:0};
const isTouch='ontouchstart' in window;
if(isTouch){ document.getElementById('touchUI').style.display='block'; initTouch(); }
function initTouch(){
  const joy=document.getElementById('joy'), knob=document.getElementById('joyKnob');
  let id=null;
  joy.addEventListener('touchstart',e=>{id=e.touches[0].identifier;},{passive:true});
  joy.addEventListener('touchmove',e=>{ const t=[...e.touches].find(t=>t.identifier===id); if(!t)return; const r=joy.getBoundingClientRect(); let dx=t.clientX-(r.left+55), dy=t.clientY-(r.top+55); const d=Math.hypot(dx,dy); if(d>40){dx*=40/d;dy*=40/d;} knob.style.left=(35+dx)+'px'; knob.style.top=(35+dy)+'px'; joyVec={x:dx/40,y:dy/40}; },{passive:true});
  joy.addEventListener('touchend',()=>{joyVec={x:0,y:0}; knob.style.left='35px'; knob.style.top='35px';});
  document.getElementById('tInteract').onclick=()=>tryInteract();
  document.getElementById('tLight').onclick=()=>{ if(S.hasTorch){S.lightOn=!S.lightOn; flash.intensity=S.lightOn?2.2:0;} };
  document.getElementById('tPhone').onclick=()=>togglePhone();
  // look drag
  let lx=null,ly=null;
  canvas.addEventListener('touchmove',e=>{ const t=e.touches[0]; if(lx!==null){ yaw-=(t.clientX-lx)*0.005; pitch-=(t.clientY-ly)*0.005; pitch=THREE.MathUtils.clamp(pitch,-1.4,1.4);} lx=t.clientX; ly=t.clientY; },{passive:true});
  canvas.addEventListener('touchend',()=>{lx=null;ly=null;});
}

// ============ INTERACTION ============
const raycaster=new THREE.Raycaster();
let currentInteract=null;
function tryInteract(){
  if(!currentInteract) return;
  const u=currentInteract.userData;
  if(u.id==='frontDoor'){ tryFrontDoor(); return; }
  if(u.id==='tv'){ watchTV(); return; }
  if(u.id==='photo'){ lookPhoto(currentInteract); return; }
  if(u.id==='mirror'){ lookMirror(); return; }
  if(u.fn){ u.fn(); return; }
  // doors
  const d=doors.find(d=>d.id===u.id);
  if(d){ toggleDoor(d); return; }
  if(u.id==='frontDoor'){ tryFrontDoor(); return; }
  if(u.id==='hiddenDoor'){ /* revealed */ }
  // hiding closets: tag by position
  if(u.id && u.id.startsWith('hide')){ enterHide(u.id); return; }
  if(u.id==='sofaCopy'){ sitSofa(); return; }
  if(u.id==='sofa'){ toast('Your sofa. In your living room, it feels safe. That worries you.'); return; }
  if(u.id==='phoneMesh'){ togglePhone(true); return; }
}
function toggleDoor(d){
  d.open=!d.open; d.group.rotation.y=d.baseY+(d.open?1.9:0);
  if(d.open){ colliders.splice(colliders.indexOf(d.col),1); } else { colliders.push(d.col); }
  playCreak();
  S.tenantAwareness+=0.5;
}
function tryFrontDoor(){
  if(!S.hasKey){ toast('Locked. The keyhole is warm. You need the spare key — kitchen.'); playKnock(new THREE.Vector3(10,0,2),0.4); return; }
  if(!S.power){ toast('Electronic deadbolt dead. No power — restore the breaker in the study.'); return; }
  // escape ending
  endGame('escape');
}
function watchTV(){
  profile.tvWatches++; saveProfile();
  if(!S.tvOn){ toast('The TV is off. Just a black rectangle. It feels watched.'); return; }
  S.tvWatches=(S.tvWatches||0)+1;
  toast('The TV shows your living room — from above, from the ceiling. You look small. Something stands in the doorway of the feed.');
  playTVStatic();
  if(S.phase<5){ setObjective(5); revealCopyRoom(); }
  if(S.tvWatches>=2 && !S.copySeen){ triggerDouble(1); }
}
function lookPhoto(m){
  S.photosChanged++; updateUnease(S.unease+2);
  const idx=S.photosChanged%2;
  m.material.map=photoStates[idx](idx); m.material.needsUpdate=true;
  toast(S.photosChanged%2? 'The photograph changed. You don\'t remember it being this way.':'The photograph changed back. You\'re not sure which is true.');
  playWhisper();
  if(S.photosChanged>=1 && !(S.evidenceMark&&S.evidenceMark.photo)){
    S.evidenceMark={...(S.evidenceMark||{}),photo:true}; updateEvidenceUI();
    setTimeout(()=>addMsg('them','That photo is why I stay. Keep it. You\'ll need the mirror.'),1500);
  }
}
function lookMirror(){
  profile.mirrorLooks++; saveProfile(); updateUnease(S.unease+5);
  toast('Your reflection lags by half a second. It smiles first.');
  mirrorTenant.visible=true;
  // delayed reflection drift: lags behind, then drifts closer
  setTimeout(()=>{
    mirrorTenant.position.set(-9.6,0,0); mirrorTenant.rotation.y=Math.PI/2;
    playWhisper(new THREE.Vector3(-9,0,0));
  },600);
  // truth ending: all 3 truths + mirror confrontation
  if(S.evidenceMark && Object.keys(S.evidenceMark).length>=3 && !S.mirrorTruth){
    S.mirrorTruth=true; setObjective(7);
    setTimeout(()=>{ toast('In the mirror, the hallway behind you is empty — but you can see yourself holding a key you haven\'t taken yet. The loop is in the reflection.'); },1800);
    setTimeout(()=>{ playSilence(1.2); endGame('truth'); },5000);
  }
  setTimeout(()=>{ mirrorTenant.visible=false; },4000);
  if(profile.mirrorLooks>=2) setTimeout(()=>addMsg('them',"Don't stare too long. It will learn your face that way."),2000);
}
function revealCopyRoom(){
  if(S.copyRevealed) return; S.copyRevealed=true;
  hiddenDoorWall.visible=false;
  const idx=colliders.findIndex(c=>c.x1>-1.5&&c.x2<1.5&&Math.abs((c.z1+c.z2)/2-3)<0.4);
  if(idx>=0) colliders.splice(idx,1);
  toast('A door has appeared in the hallway where there was only wall. It smells like your living room.');
  playCreak(); setTimeout(()=>queuePhone(5),2000);
}
function triggerDouble(phase){
  S.copySeen=true; S.doublePhase=phase;
  doubleMesh.visible=true; doubleMesh.position.set(0,0,5.9); doubleMesh.rotation.y=Math.PI;
  if(phase===1){ toast('In the copy living room, your double sits on the sofa, facing away. The TV shows you — from behind.'); }
  else { toast('The copy living room again. The double is standing now. Facing you.'); }
  updateUnease(S.unease+15); setTimeout(()=>queuePhone(phase===1?5:6),1500);
}
function sitSofa(){
  // replacement ending path
  if(S.doublePhase>=2){ endGame('replacement'); }
  else toast('You don\'t sit. Your legs want to.');
}
function enterHide(id){
  S.hiding=id;
  profile.hides[id]=(profile.hides[id]||0)+1; saveProfile();
  toast('You hide in the closet. Breathing feels too loud. [E] to leave');
  updateUnease(S.unease+2);
  if(profile.hides[id]>=2){ setTimeout(()=>{ playKnock(new THREE.Vector3(player.position.x,0,player.position.z),0.6); showSubtitle('— knocking, from outside the closet. It knows this spot —'); addMsg('them',"You hid there last night too. It's waiting." ); },4000); }
  if(profile.hides[id]>=3){ tenantGoto(player.position.x,player.position.z); tenantState.mode='outsideCloset'; }
}
function exitHide(){ S.hiding=null; toast('You step out. The room feels closer than before.'); }
// hide spots
const hide1=box(-9.8,1.0,-3.5,0.3,2.0,1.0,MAT.wood); reg(hide1,'hide_bedroom','Hide in closet');
const hide2=box(9.9,1.0,0.2,0.3,2.0,1.2,MAT.wood); reg(hide2,'hide_study','Hide in closet');
const hide3=box(-6,1.0,2.8,1.0,2.0,0.4,MAT.wood); reg(hide3,'hide_hall','Hide in hall closet');
// sofa interactables share position with furniture() meshes (already placed)

function endGame(kind){
  if(S.ended) return; S.ended=true; profile.endingsSeen[kind]=true; saveProfile();
  document.exitPointerLock&&document.exitPointerLock();
  const stats=`Unease ${Math.round(S.unease)} · Behind-checks learned: ${profile.glances} · Hides used: ${Object.values(profile.hides).reduce((a,b)=>a+b,0)} · Time: ${Math.round((Date.now()-S.startTime)/1000)}s · Run #${profile.runs}`;
  const screen=document.getElementById('endingScreen');
  const title=document.getElementById('endingTitle'), text=document.getElementById('endingText');
  if(kind==='escape'){
    title.textContent='ENDING — YOU LEFT (MAYBE)';
    text.textContent='The door opens onto the same hallway. You run — and the stairs go down. Your phone buzzes: “You left it open. I\'m standing in your doorway. I\'m wearing your face.”\n\nYou escape. But every mirror still lags. And 3:17 still comes every night.\n\n(True ending uncertain. The Tenant is still learning. Install the game again — it will remember your habits.)';
  } else if(kind==='replacement'){
    title.textContent='ENDING — REPLACEMENT';
    text.textContent='You sit. It stands. Warmth spreads like sleep. You are the one on the sofa now, facing away, while something else gets up and goes to the kitchen to find the key.\n\nYou want to shout “Don\'t turn around!” But your mouth is full of someone else\'s breathing.\n\nTomorrow, when the new tenant wakes at 3:17, it will get the same message — from you.';
  } else if(kind==='truth'){
    title.textContent='ENDING — THE TRUTH (WHICH EXPLAINS NOTHING)';
    text.textContent='The diary, the photo, the tape: you are the anomaly the apartment repeats. Day 1, Day 41, tomorrow — same kitchen, same key, same double.\n\nThe Tenant isn\'t a monster. It\'s the apartment\'s memory, made of everyone who\'ve checked behind them one time too many.\n\nKnowing doesn\'t make it leave. But the mirror finally stops lagging. In it, the sofa is empty. In it, you are alone.\n\nYou just don\'t trust the mirror anymore.';
  }
  document.getElementById('endingStats').textContent=stats;
  document.getElementById('hud').style.display='none';
  screen.style.display='flex';
}

// ============ ROOM DETECTION & LEARNING EVENTS ============
function roomFromPos(x,z){
  if(z>=3) return 'copy';
  if(x<-6 && z>=-1.5 && z<3) return 'bathroom';
  if(x<-4 && z<-1.5) return 'bedroom';
  if(x>4 && z<1) return 'kitchen';
  if(x>4 && z>=1) return 'study';
  if(x>-4 && x<=4 && z<1) return 'living';
  return 'hallway';
}
function triggerBehindManifest(){
  // silhouette behind, disappears when looked
  tenant.position.set(player.position.x - Math.sin(yaw)*1.5, 0, player.position.z - Math.cos(yaw)*1.5);
  tenant.rotation.y=yaw+Math.PI;
  tenant.visible=true; tenantState.mode='behind'; tenantState.timer=1.2;
  playWhisper(tenant.position); playThud();
  updateUnease(S.unease+10);
  showSubtitle('— it was right behind you —');
}
function scheduledEvents(dt){
  const now=Date.now();
  // room trust learning
  S.roomTimers[S.roomNow]=(S.roomTimers[S.roomNow]||0)+dt;
  profile.roomTime[S.roomNow]=(profile.roomTime[S.roomNow]||0)+dt; saveProfile();
  // trusted room event
  if((S.roomTimers[S.roomNow]||0)>18 && now-S.lastEvent>22000){
    S.lastEvent=now; S.roomTimers[S.roomNow]=0;
    const evts=[
      ()=>{ photoMeshes.forEach(p=>{p.material.map=photoStates[1](); p.material.needsUpdate=true;}); toast('A photograph has changed while you weren\'t looking.'); },
      ()=>{ playKnock(new THREE.Vector3(player.position.x+2,0,player.position.z),0.5); showSubtitle('— a knock, from inside the walls —'); },
      ()=>{ playWhisper(new THREE.Vector3(player.position.x-2,0,player.position.z)); },
      ()=>{ if(breathGain) breathGain.gain.value=0.02; setTimeout(()=>{if(breathGain)breathGain.gain.value=0;},5000); showSubtitle('— breathing, nearby, in rhythm with you —'); },
      ()=>{ playSilence(1.8); },
    ];
    evts[Math.floor(Math.random()*evts.length)]();
    updateUnease(S.unease+4);
  }
  // footsteps echo (matching rhythm)
  if(now-S.lastEvent>35000 && Math.random()<dt*0.02){
    S.lastEvent=now;
    for(let i=0;i<4;i++) setTimeout(()=>playStep(0.15,true,tenant.position), i*420);
    showSubtitle('— footsteps follow you. Sometimes they match your rhythm exactly. —');
  }
  // hallway longer (once) — visual stretch: move south walls outward
  if(!S.hallwayLong && (profile.roomTime.hallway||0)>25){
    S.hallwayLong=true; hiddenDoorWall.position.z=3.6; wall(0,7,21,0.3); // visual stretch echo
    playCreak(); toast('The hallway is longer than it was. You are certain. You took a photo. The photo shows the same length.'); updateUnease(S.unease+6);
  }
  // phases
  if(!S.power && S.phase>=2 && profile.glances>=2 && !S._q2){ S._q2=true; queuePhone(2); }
  if(S.copySeen && S.doublePhase===1 && profile.roomTime.copy>8 && !S.doublePhase2Triggered){ S.doublePhase2Triggered=true; setTimeout(()=>triggerDouble(2),2000); }
  // tenant glimpses in hallway end
  if(S.roomNow==='hallway' && Math.random()<dt*0.03 && S.tenantVisible<30){
    tenant.position.set(8,0,2); tenant.rotation.y=-Math.PI/2; tenant.visible=true; tenantState.mode='glimpse'; tenantState.timer=1.5;
    playThud();
  }
  // unease creep
  updateUnease(Math.min(100, S.unease+dt*0.25));
  if(S.unease>85 && !S.ended){ tenantGoto(player.position.x,player.position.z); if(Math.hypot(player.position.x-tenant.position.x,player.position.z-tenant.position.z)<1.2){ profile.caught++; saveProfile(); endGame('replacement'); } }
}

// ============ MOVEMENT & COLLISION ============
function collide(pos){
  for(const c of colliders){
    if(pos.x>c.x1-0.3 && pos.x<c.x2+0.3 && pos.z>c.z1-0.3 && pos.z<c.z2+0.3){
      const dx1=pos.x-(c.x1-0.3), dx2=(c.x2+0.3)-pos.x, dz1=pos.z-(c.z1-0.3), dz2=(c.z2+0.3)-pos.z;
      const m=Math.min(dx1,dx2,dz1,dz2);
      if(m===dx1) pos.x=c.x1-0.3; else if(m===dx2) pos.x=c.x2+0.3; else if(m===dz1) pos.z=c.z1-0.3; else pos.z=c.z2+0.3;
    }
  }
  pos.x=THREE.MathUtils.clamp(pos.x,-10,10); pos.z=THREE.MathUtils.clamp(pos.z,-6.6,6.6);
}
let stepPhase=0, lastStepTime=0;
function updatePlayer(dt){
  let mx=0,mz=0;
  if(keys['w']||keys['arrowup']) mz-=1; if(keys['s']||keys['arrowdown']) mz+=1; if(keys['a']||keys['arrowleft']) mx-=1; if(keys['d']||keys['arrowright']) mx+=1;
  mx+=joyVec.x; mz+=joyVec.y;
  const moving=Math.hypot(mx,mz)>0.1;
  S.running=keys['shift']&&moving; if(S.running){profile.runTime+=dt; saveProfile();}
  let speed=S.running?3.8:(S.sneak?1.0:2.1);
  if(S.hiding) speed=0;
  if(moving){
    const f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const dir=new THREE.Vector3().addScaledVector(f,-mz).addScaledVector(r,mx).normalize();
    player.position.addScaledVector(dir,speed*dt);
    // head bob + steps
    stepPhase+=dt*(S.running?11:7);
    if(Date.now()-lastStepTime> (S.running?280:S.sneak?500:380)){ lastStepTime=Date.now(); playStep(S.sneak?0.04:S.running?0.3:0.12); if(S.running) {S.tenantAwareness+=1;} }
  }
  player.position.y=1.6+Math.sin(stepPhase)*0.03*(moving?1:0);
  // leaving hiding
  if(S.hiding && (keys['w']||keys['a']||keys['s']||keys['d'])) exitHide();
  collide(player.position);
  S.roomNow=roomFromPos(player.position.x,player.position.z);
  camera.position.copy(player.position);
  camera.rotation.set(pitch,yaw,0,'YXZ');
  flash.position.copy(player.position); flash.target.position.set(player.position.x-Math.sin(yaw)*4, player.position.y-0.3, player.position.z-Math.cos(yaw)*4);
  // tenant follow when aware
  if(S.tenantAwareness>15 && !tenant.visible){
    if(Math.random()<dt*0.1){ tenant.position.set(player.position.x+(Math.random()-0.5)*6,0,player.position.z+(Math.random()-0.5)*6); collide(tenant.position); }
  }
  if(S.tenantAwareness>40){ tenant.visible=true; tenant.position.lerp(new THREE.Vector3(player.position.x,0,player.position.z), dt*0.6); tenant.lookAt(player.position.x,0,player.position.z); }
  // TV live view from above
  if(S.tvOn){
    tvCam.position.set(player.position.x,3.2,player.position.z+1); tvCam.lookAt(player.position.x,0,player.position.z);
    renderer.setRenderTarget(tvRT); renderer.render(scene,tvCam); renderer.setRenderTarget(null);
    // draw label onto canvas for "live" feel
    const ctx=tvCanvas.getContext('2d'); ctx.fillStyle='rgba(255,0,0,0.9)'; ctx.font='bold 18px monospace'; ctx.fillText('● LIVE — CAM 4 (CEILING)',10,24); tvTex.needsUpdate=true;
  }
}
function updateInteract(){
  raycaster.setFromCamera({x:0,y:0},camera); raycaster.far=3.2;
  const objs=[];
  scene.traverse(o=>{ if(o.userData&&o.userData.interact && o.visible) objs.push(o); });
  const hit=raycaster.intersectObjects(objs,false)[0];
  const prompt=document.getElementById('prompt');
  if(hit){ let o=hit.object; while(o && !(o.userData&&o.userData.interact)) o=o.parent; currentInteract=o; prompt.textContent=o?.userData?.label||''; prompt.style.display='block'; }
  else { currentInteract=null; prompt.style.display='none'; }
}

// ============ MAIN LOOP ============
let firstMsgDone=false;
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),0.05);
  if(S.started && !S.ended && !S.paused){
    if(!phoneOpen || true) updatePlayer(dt);
    // tenant timers
    if(tenant.visible){ tenantState.timer-=dt; if(tenantState.timer<=0){ tenant.visible=false; S.tenantAwareness=Math.max(0,S.tenantAwareness-3); } if(tenantState.mode==='behind' && tenantState.timer>0){ tenant.position.x=player.position.x-Math.sin(yaw)*1.2; tenant.position.z=player.position.z-Math.cos(yaw)*1.2; } }
    if(doubleMesh.visible){ doubleMesh.rotation.y = S.doublePhase===2 ? yaw+Math.PI : Math.PI; /* stare slowly */ }
    scheduledEvents(dt);
    updateInteract();
    // flashlight flicker at high unease; hallway lights flicker when trusted
    if(S.lightOn) flash.intensity=2.2 + (Math.random()<0.02?-1.5:0);
    if(S.roomNow==='hallway' && roomLights[3] && Math.random()<0.02) roomLights[3].intensity=0.1 + Math.random()*0.3; else if(roomLights[3] && S.roomNow!=='hallway') roomLights[3].intensity=0.9;
  }
  renderer.render(scene,camera);
}
animate();

// ============ START / PAUSE ============
function showPause(){ S.paused=true; document.getElementById('pauseScreen').style.display='flex'; document.exitPointerLock&&document.exitPointerLock(); }
function hidePause(){ S.paused=false; document.getElementById('pauseScreen').style.display='none'; lockPointer(); }
document.getElementById('beginBtn').onclick=()=>{
  initAudio();
  document.getElementById('startScreen').style.display='none';
  document.getElementById('hud').style.display='block';
  S.started=true; updateEvidenceUI(); updateUnease(5); setObjective(0);
  updateInv();
  // face east toward bedroom door so the first frame has context, not a wall
  yaw=player.yaw; pitch=player.pitch;
  setTimeout(lockPointer, 50);
  setTimeout(()=>{ addMsg('them',"Don't turn around. I'm trying to keep it away from you."); playKnock(new THREE.Vector3(-7,0,-2),0.5); toast('3:17 AM. Your phone. [TAB] to read.'); },2500);
  setTimeout(()=>{ queuePhone(1); },6000);
};
function updateInv(){ updateEvidenceUI(); }
document.getElementById('resumeBtn').onclick=hidePause;
document.getElementById('restartBtn2').onclick=()=>location.reload();
document.getElementById('againBtn').onclick=()=>location.reload();
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
addEventListener('beforeunload',saveProfile);
// interactions via reg() userData.fn handled in tryInteract
