const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));

const W = 1000, H = 650, MAX_PLAYERS = 6, ROUND_SECONDS = 300, ROUNDS = 3;
const SPAWNS = [
  { x: 190, y: 150, a: 0.4 }, { x: 500, y: 115, a: 1.3 },
  { x: 810, y: 150, a: 2.4 }, { x: 190, y: 500, a: -0.5 },
  { x: 500, y: 535, a: -1.6 }, { x: 810, y: 500, a: -2.4 }
];
const COLORS = ["#ff4f64", "#45a7ff", "#ffd34e", "#49d18d", "#c47aff", "#ff994e"];
const rooms = new Map();

const rand = (a,b) => Math.random() * (b-a) + a;
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
function makeRoom(code) {
  return { code, players: [], bullets: [], pickups: [], round: 0, phase: "lobby",
    timeLeft: ROUND_SECONDS, roundEndsAt: 0, lastTick: Date.now(), winner: null,
    roundScores: [], scores: {}, message: "Waiting for 6 drivers to join.", nextPickup: 0 };
}
function spawnPickups(room) {
  room.pickups = [];
  const types = ["machinegun","shotgun","rocket"];
  for (let i=0;i<4;i++) room.pickups.push({ id: `${Date.now()}-${Math.random()}`, x: rand(100,W-100), y: rand(100,H-100), type: types[Math.floor(Math.random()*types.length)] });
}
function resetRound(room) {
  room.bullets = [];
  room.pickups = [];
  room.players.forEach((p,i) => {
    const s = SPAWNS[i];
    p.x=s.x; p.y=s.y; p.angle=s.a; p.hp=100; p.alive=true; p.weapon=null; p.weaponUntil=0;
    p.cooldown=0; p.input={up:false,down:false,left:false,right:false,fire:false};
  });
  room.phase = "playing";
  room.timeLeft = ROUND_SECONDS;
  room.roundEndsAt = Date.now() + ROUND_SECONDS*1000;
  room.message = `Round ${room.round} started!`;
  room.nextPickup = Date.now() + 1200;
  spawnPickups(room);
}
function publicState(room) {
  const now = Date.now();
  return {
    code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS,
    timeLeft: Math.max(0, Math.ceil((room.roundEndsAt-now)/1000)),
    message: room.message, winner: room.winner,
    players: room.players.map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,angle:p.angle,hp:p.hp,alive:p.alive,weapon:p.weapon,weaponLeft:p.weapon?Math.max(0,Math.ceil((p.weaponUntil-now)/1000)):0,score:room.scores[p.id]||0,ready:!!p.ready})),
    bullets: room.bullets.map(b=>({x:b.x,y:b.y,angle:b.angle,color:b.color,kind:b.kind})),
    pickups: room.pickups.map(g=>({id:g.id,x:g.x,y:g.y,type:g.type}))
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function tell(room,msg) { room.message=msg; }
function beginGame(room) {
  room.round=1; room.winner=null; room.roundScores=[];
  room.players.forEach(p=>room.scores[p.id]=0);
  resetRound(room);
}
function endRound(room) {
  const alive=room.players.filter(p=>p.alive);
  let top = alive.length ? alive : room.players;
  top.sort((a,b)=>b.hp-a.hp);
  const champ=top[0];
  if (champ) room.scores[champ.id]=(room.scores[champ.id]||0)+1;
  room.roundScores.push(champ ? champ.id : null);
  if (room.round >= ROUNDS) {
    const ranked=[...room.players].sort((a,b)=>(room.scores[b.id]||0)-(room.scores[a.id]||0));
    room.winner=ranked[0] ? {id:ranked[0].id,name:ranked[0].name,score:room.scores[ranked[0].id]||0}:null;
    room.phase="finished";
    tell(room,`Tournament over! ${room.winner?.name || "No one"} wins with ${room.winner?.score || 0} round wins.`);
  } else {
    room.phase="intermission";
    tell(room,`Round ${room.round} over. ${champ?.name || "No one"} takes the round. Next round begins in 8 seconds.`);
    setTimeout(()=>{
      if (room.phase!=="intermission") return;
      room.round++;
      resetRound(room);
      broadcast(room);
    },8000);
  }
}
function damage(room, target, amount, attackerId) {
  if (!target.alive) return;
  target.hp=Math.max(0,target.hp-amount);
  if (target.hp<=0) {
    target.alive=false; target.weapon=null;
    const attacker=room.players.find(p=>p.id===attackerId);
    if (attacker && attacker.id!==target.id) room.scores[attacker.id]=(room.scores[attacker.id]||0)+0.25;
    tell(room,`${target.name} was wrecked${attacker && attacker.id!==target.id ? ` by ${attacker.name}` : ""}!`);
    if (room.players.filter(p=>p.alive).length<=1) endRound(room);
  }
}
function tick(room, dt) {
  if (room.phase!=="playing") return;
  const now=Date.now();
  room.timeLeft=Math.max(0,Math.ceil((room.roundEndsAt-now)/1000));
  for (const p of room.players) {
    if (!p.alive) continue;
    if (p.weapon && now>=p.weaponUntil) { p.weapon=null; p.weaponUntil=0; }
    const input=p.input;
    if (input.left) p.angle-=2.8*dt;
    if (input.right) p.angle+=2.8*dt;
    const speed=(input.up?205:0)-(input.down?125:0);
    p.x=clamp(p.x+Math.cos(p.angle)*speed*dt,35,W-35);
    p.y=clamp(p.y+Math.sin(p.angle)*speed*dt,35,H-35);
    if (p.x<=36 || p.x>=W-36 || p.y<=36 || p.y>=H-36) damage(room,p,5*dt,null);
    if (input.fire && p.weapon && now>=p.cooldown) {
      p.cooldown=now+(p.weapon==="shotgun"?800:p.weapon==="rocket"?900:180);
      const count=p.weapon==="shotgun"?5:1;
      for(let i=0;i<count;i++){
        const spread=p.weapon==="shotgun"?(i-2)*0.13:rand(-0.025,0.025);
        room.bullets.push({id:Math.random(),owner:p.id,x:p.x+Math.cos(p.angle)*22,y:p.y+Math.sin(p.angle)*22,angle:p.angle+spread,speed:p.weapon==="rocket"?390:500,damage:p.weapon==="rocket"?34:p.weapon==="shotgun"?8:10,life:1.8,color:p.color,kind:p.weapon});
      }
    }
  }
  // Car collisions
  for(let i=0;i<room.players.length;i++) for(let j=i+1;j<room.players.length;j++){
    const a=room.players[i],b=room.players[j];
    if(!a.alive||!b.alive)continue;
    const d=dist(a,b);
    if(d<37){
      const nx=(b.x-a.x)/(d||1), ny=(b.y-a.y)/(d||1);
      a.x=clamp(a.x-nx*2,35,W-35); a.y=clamp(a.y-ny*2,35,H-35);
      b.x=clamp(b.x+nx*2,35,W-35); b.y=clamp(b.y+ny*2,35,H-35);
      damage(room,a,12*dt,b.id); damage(room,b,12*dt,a.id);
    }
  }
  // Bullets
  room.bullets=room.bullets.filter(b=>{
    b.x+=Math.cos(b.angle)*b.speed*dt; b.y+=Math.sin(b.angle)*b.speed*dt; b.life-=dt;
    if(b.life<=0||b.x<0||b.x>W||b.y<0||b.y>H)return false;
    for(const p of room.players){
      if(!p.alive||p.id===b.owner)continue;
      if(Math.hypot(p.x-b.x,p.y-b.y)<21){damage(room,p,b.damage,b.owner);return false;}
    }
    return true;
  });
  // Pickups: one active weapon per car; weapons expire after 12 sec.
  for(const p of room.players){
    if(!p.alive||p.weapon)continue;
    const idx=room.pickups.findIndex(g=>Math.hypot(p.x-g.x,p.y-g.y)<29);
    if(idx>=0){
      const g=room.pickups.splice(idx,1)[0];
      p.weapon=g.type;p.weaponUntil=now+12000;
      tell(room,`${p.name} picked up ${g.type.toUpperCase()}!`);
    }
  }
  if(now>=room.nextPickup && room.pickups.length<4){
    room.pickups.push({id:`${now}-${Math.random()}`,x:rand(80,W-80),y:rand(80,H-80),type:["machinegun","shotgun","rocket"][Math.floor(Math.random()*3)]});
    room.nextPickup=now+5000;
  }
  if(room.timeLeft<=0) endRound(room);
}
io.on("connection",socket=>{
  socket.on("join",({name,code})=>{
    name=String(name||"").trim().slice(0,18);
    code=String(code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
    if(!name||!code)return socket.emit("notice","Enter a player name and room code.");
    let room=rooms.get(code);
    if(!room){room=makeRoom(code);rooms.set(code,room);}
    if(room.phase!=="lobby")return socket.emit("notice","This room has already started. Use a new room code.");
    if(room.players.length>=MAX_PLAYERS)return socket.emit("notice","Room is full (6 players maximum).");
    if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return socket.emit("notice","That name is already taken in this room.");
    const index=room.players.length,s=SPAWNS[index];
    room.players.push({id:socket.id,name,color:COLORS[index],x:s.x,y:s.y,angle:s.a,hp:100,alive:true,weapon:null,weaponUntil:0,cooldown:0,input:{},ready:true});
    socket.data.roomCode=code;socket.join(code);
    tell(room,`${name} joined (${room.players.length}/6).`);
    broadcast(room);
  });
  socket.on("start",()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room)return socket.emit("notice","Join a room first.");
    if(room.players.length<2)return socket.emit("notice","Exactly 6 players are required to start.");
    if(room.phase!=="lobby")return;
    beginGame(room);broadcast(room);
  });
  socket.on("input",input=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=="playing")return;
    const p=room.players.find(p=>p.id===socket.id);
    if(!p||!p.alive)return;
    p.input={up:!!input.up,down:!!input.down,left:!!input.left,right:!!input.right,fire:!!input.fire};
  });
  socket.on("disconnect",()=>{
    const room=rooms.get(socket.data.roomCode);if(!room)return;
    const i=room.players.findIndex(p=>p.id===socket.id);if(i<0)return;
    const [p]=room.players.splice(i,1);
    if(room.phase==="lobby"&&room.players.length===0){rooms.delete(room.code);return;}
    if(room.phase==="playing"){
      tell(room,`${p.name} disconnected.`);
      if(room.players.filter(x=>x.alive).length<=1)endRound(room);
    } else tell(room,`${p.name} disconnected.`);
    broadcast(room);
  });
});
setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values()){
    const dt=Math.min(.05,(now-room.lastTick)/1000);room.lastTick=now;
    tick(room,dt);
    if(room.phase!=="lobby")broadcast(room);
  }
},50);
server.listen(PORT,()=>console.log(`Stadium Crash Arena listening on port ${PORT}`));
