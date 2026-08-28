const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 2e6
});

app.use(express.static(path.join(__dirname, 'public')));

const MAP = { width: 3600, height: 3600 };

const VENTS = [
  { id: 0, x: 400, y: 400, connections: [1, 2, 6] },
  { id: 1, x: 1700, y: 350, connections: [0, 3, 6] },
  { id: 2, x: 450, y: 1900, connections: [0, 4, 6] },
  { id: 3, x: 3000, y: 500, connections: [1, 5, 6] },
  { id: 4, x: 900, y: 3000, connections: [2, 5, 6] },
  { id: 5, x: 2900, y: 2800, connections: [3, 4, 6] },
  { id: 6, x: 1800, y: 1800, connections: [0, 1, 2, 3, 4, 5] }
];

const WALLS = [
  { x: 1000, y: 1000, w: 600, h: 50 },
  { x: 2200, y: 1200, w: 50, h: 700 },
  { x: 1200, y: 2400, w: 800, h: 50 },
  { x: 700, y: 1500, w: 50, h: 450 }
];

const ZONES = [
  { id: 'safe', x: 200, y: 200, w: 600, h: 600, type: 'safe' },
  { id: 'speed', x: 2800, y: 2800, w: 500, h: 500, type: 'speed' },
  { id: 'danger', x: 1600, y: 800, w: 400, h: 400, type: 'danger' }
];

const TASKS = [
  { id: 'wires', name: 'Kabloları Bağla', x: 600, y: 700, reward: 80 },
  { id: 'scan', name: 'Medbay Tarama', x: 2500, y: 900, range: 80 },
  { id: 'fuel', name: 'Yakıt Doldur', x: 900, y: 2600, range: 80 },
  { id: 'card', name: 'Kart Okut', x: 2700, y: 2200, range: 80 }
];

const ROLES = ['crewmate', 'crewmate', 'crewmate', 'engineer', 'impostor'];

const state = {
  players: {},
  map: MAP,
  vents: VENTS,
  walls: WALLS,
  zones: ZONES,
  tasks: TASKS.map(t => ({ ...t, completedBy: [] })),
  powerups: [],
  timeOfDay: 0,          // 0-1 (0 = gece, 0.5 = gündüz)
  meeting: null,         // acil durum toplantısı
  pings: {}
};

function spawnPowerups() {
  const spots = [
    { x: 900, y: 900 }, { x: 2500, y: 900 },
    { x: 900, y: 2500 }, { x: 2500, y: 2500 },
    { x: 1800, y: 1200 }, { x: 1800, y: 2400 }
  ];
  state.powerups = spots.map((s, i) => ({
    id: i,
    x: s.x,
    y: s.y,
    type: ['speed', 'glow', 'shield', 'ghost'][Math.floor(Math.random() * 4)],
    active: true
  }));
}
spawnPowerups();
setInterval(spawnPowerups, 40000);

// Gündüz/Gece döngüsü
setInterval(() => {
  state.timeOfDay = (state.timeOfDay + 0.0008) % 1;
}, 100);

const lastChat = {};
const lastInput = {};
const lastPing = {};

setInterval(() => {
  const now = Date.now();

  for (const id in state.players) {
    const p = state.players[id];
    if (p.inVent || (state.meeting && state.meeting.active)) continue;

    // Hız zone kontrolü
    let speedMult = 1;
    for (const z of ZONES) {
      if (p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y < z.y + z.h) {
        if (z.type === 'speed') speedMult = 1.45;
        if (z.type === 'danger' && p.role !== 'impostor') speedMult = 0.7;
      }
    }

    p.x += p.vx * speedMult;
    p.y += p.vy * speedMult;
    p.vx *= 0.80;
    p.vy *= 0.80;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
    if (Math.abs(p.vy) < 0.1) p.vy = 0;

    p.x = Math.max(40, Math.min(MAP.width - 40, p.x));
    p.y = Math.max(40, Math.min(MAP.height - 40, p.y));

    // Duvar çarpışması
    for (const wall of WALLS) {
      if (p.x + 24 > wall.x && p.x - 24 < wall.x + wall.w &&
          p.y + 24 > wall.y && p.y - 24 < wall.y + wall.h) {
        const cx = wall.x + wall.w / 2;
        const cy = wall.y + wall.h / 2;
        if (Math.abs(p.x - cx) > Math.abs(p.y - cy)) {
          p.x += p.x > cx ? 12 : -12;
          p.vx = 0;
        } else {
          p.y += p.y > cy ? 12 : -12;
          p.vy = 0;
        }
      }
    }

    // Soft player collision
    for (const oid in state.players) {
      if (oid === id) continue;
      const o = state.players[oid];
      if (o.inVent) continue;
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < 50 && d > 0) {
        const push = (50 - d) * 0.18;
        p.x += ((p.x - o.x) / d) * push;
        p.y += ((p.y - o.y) / d) * push;
      }
    }

    // Power-up
    for (const pu of state.powerups) {
      if (!pu.active) continue;
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < 40) {
        pu.active = false;
        applyPowerup(p, pu.type);
        io.emit('serverMessage', `${p.name} ${pu.type} aldı!`);
        io.to(id).emit('powerupTaken', pu.type);
      }
    }

    // Süre bitince temizle
    if (p.speedUntil && now > p.speedUntil) { p.speedUntil = 0; p.maxSpeed = 9; }
    if (p.glowUntil && now > p.glowUntil) p.glowUntil = 0;
    if (p.ghostUntil && now > p.ghostUntil) p.ghostUntil = 0;
    if (p.shieldUntil && now > p.shieldUntil) p.shieldUntil = 0;
  }

  // Eski pingleri temizle
  for (const pid in state.pings) {
    if (now - state.pings[pid].time > 5000) delete state.pings[pid];
  }

  io.emit('gameState', state);
}, 1000 / 60);

function applyPowerup(p, type) {
  const now = Date.now();
  if (type === 'speed') { p.maxSpeed = 15; p.speedUntil = now + 14000; }
  if (type === 'glow') p.glowUntil = now + 16000;
  if (type === 'ghost') p.ghostUntil = now + 9000;
  if (type === 'shield') p.shieldUntil = now + 12000;
}

function assignRole() {
  return ROLES[Math.floor(Math.random() * ROLES.length)];
}

io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id);

  // ========== VOICE ROOM ==========
  socket.on('voice-join', () => {
    socket.join('voice');
    const clients = io.sockets.adapter.rooms.get('voice') || new Set();
    for (const id of clients) {
      if (id !== socket.id) {
        socket.emit('voice-peer', id);
        io.to(id).emit('voice-peer', socket.id);
      }
    }
  });

  socket.on('voice-offer', ({ to, offer }) => io.to(to).emit('voice-offer', { from: socket.id, offer }));
  socket.on('voice-answer', ({ to, answer }) => io.to(to).emit('voice-answer', { from: socket.id, answer }));
  socket.on('voice-ice', ({ to, candidate }) => io.to(to).emit('voice-ice', { from: socket.id, candidate }));

  // ========== JOIN ==========
  socket.on('joinGame', (data) => {
    if (!data?.name) return;
    let name = data.name.trim().substring(0, 14) || 'Anonim';
    let finalName = name;
    let c = 1;
    while (Object.values(state.players).some(p => p.name === finalName)) finalName = `${name}${c++}`;

    const role = assignRole();

    state.players[socket.id] = {
      x: MAP.width / 2 + (Math.random() - 0.5) * 200,
      y: MAP.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0, vy: 0,
      name: finalName,
      color: data.color || '#00d2ff',
      role,
      msg: '',
      isTyping: false,
      inVent: false,
      ventId: null,
      emote: null,
      maxSpeed: 9,
      speedUntil: 0, glowUntil: 0, ghostUntil: 0, shieldUntil: 0,
      inventory: [],
      tasksDone: 0,
      ventsUsed: 0,
      messagesSent: 0,
      joinedAt: Date.now()
    };

    socket.emit('init', {
      id: socket.id,
      vents: VENTS,
      walls: WALLS,
      zones: ZONES,
      tasks: state.tasks,
      map: MAP,
      role
    });

    socket.broadcast.emit('playSound', 'join');
    io.emit('serverMessage', `✦ ${finalName} katıldı (${role})`);
    io.emit('playerCount', Object.keys(state.players).length);
    socket.emit('start-voice');
  });

  // ========== INPUT ==========
  socket.on('input', (data) => {
    const p = state.players[socket.id];
    if (!p || p.inVent || (state.meeting && state.meeting.active)) return;
    const now = Date.now();
    if (lastInput[socket.id] && now - lastInput[socket.id] < 10) return;
    lastInput[socket.id] = now;

    let dx = data.dx || 0, dy = data.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const speed = p.maxSpeed || 9;
    p.vx = dx * speed;
    p.vy = dy * speed;
  });

  socket.on('typing', s => { if (state.players[socket.id]) state.players[socket.id].isTyping = !!s; });

  // ========== VENT ==========
  socket.on('enterVent', (ventId) => {
    const p = state.players[socket.id];
    if (!p || p.inVent) return;
    const vent = VENTS.find(v => v.id === ventId);
    if (!vent || Math.hypot(p.x - vent.x, p.y - vent.y) > 95) return;
    // Engineer her yerden, diğerleri sadece yakın
    p.inVent = true;
    p.ventId = ventId;
    p.vx = p.vy = 0;
    p.ventsUsed++;
    io.emit('serverMessage', `🌀 ${p.name} vent'e girdi`);
    socket.emit('playSound', 'vent');
  });

  socket.on('exitVent', (targetId) => {
    const p = state.players[socket.id];
    if (!p || !p.inVent) return;
    const cur = VENTS.find(v => v.id === p.ventId);
    if (!cur?.connections.includes(targetId)) return;
    const target = VENTS.find(v => v.id === targetId);
    if (!target) return;
    p.x = target.x; p.y = target.y;
    p.inVent = false; p.ventId = null;
    p.vx = p.vy = 0;
    io.emit('serverMessage', `🌀 ${p.name} ventten çıktı`);
    socket.emit('playSound', 'vent');
  });

  socket.on('leaveVent', () => {
    const p = state.players[socket.id];
    if (p?.inVent) { p.inVent = false; p.ventId = null; }
  });

  // ========== TASK ==========
  socket.on('doTask', (taskId) => {
    const p = state.players[socket.id];
    if (!p || p.role === 'impostor') return;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.completedBy.includes(socket.id)) return;
    if (Math.hypot(p.x - task.x, p.y - task.y) > task.range) return;

    task.completedBy.push(socket.id);
    p.tasksDone++;
    p.inventory.push({ type: 'credit', amount: 10 });
    io.emit('serverMessage', `✅ ${p.name} görevi tamamladı: ${task.name}`);
    socket.emit('taskDone', taskId);
  });

  // ========== PING ==========
  socket.on('ping', (data) => {
    const p = state.players[socket.id];
    if (!p) return;
    const now = Date.now();
    if (lastPing[socket.id] && now - lastPing[socket.id] < 2000) return;
    lastPing[socket.id] = now;
    state.pings[socket.id] = { x: data.x, y: data.y, color: p.color, name: p.name, time: now };
  });

  // ========== MEETING ==========
  socket.on('callMeeting', () => {
    const p = state.players[socket.id];
    if (!p || (state.meeting && state.meeting.active)) return;
    state.meeting = {
      active: true,
      caller: p.name,
      votes: {},
      endsAt: Date.now() + 45000
    };
    io.emit('serverMessage', `🚨 ACİL DURUM! ${p.name} toplantı başlattı`);
    io.emit('meetingStart', state.meeting);

    setTimeout(() => {
      if (state.meeting?.active) {
        state.meeting.active = false;
        io.emit('meetingEnd', state.meeting.votes);
        state.meeting = null;
      }
    }, 45000);
  });

  socket.on('vote', (targetId) => {
    if (!state.meeting?.active) return;
    state.meeting.votes[socket.id] = targetId;
    io.emit('voteUpdate', state.meeting.votes);
  });

  // ========== CHAT + KOMUTLAR ==========
  socket.on('chat', (text) => {
    const p = state.players[socket.id];
    if (!p || typeof text !== 'string') return;
    text = text.trim().substring(0, 140);
    if (!text) return;
    const now = Date.now();
    if (lastChat[socket.id] && now - lastChat[socket.id] < 600) return;
    lastChat[socket.id] = now;

    if (text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      if (cmd === 'ses' && args[0]) {
        io.emit('playCustomSound', args[0]);
        io.emit('serverMessage', `🔊 ${p.name} ses açtı`);
        return;
      }
      if (cmd === 'me' && args.length) {
        io.emit('serverMessage', `* ${p.name} ${args.join(' ')}`);
        return;
      }
      if (cmd === 'emote' || cmd === 'e') {
        p.emote = (args[0] || '😎').substring(0, 6);
        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].emote = null; }, 4000);
        return;
      }
      if (cmd === 'dance') {
        p.emote = '💃';
        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].emote = null; }, 5000);
        return;
      }
      if (cmd === 'role') {
        socket.emit('serverMessage', `Rolün: ${p.role}`);
        return;
      }
      if (cmd === 'stats') {
        socket.emit('serverMessage', `Görev: ${p.tasksDone} | Vent: ${p.ventsUsed} | Mesaj: ${p.messagesSent}`);
        return;
      }
      if (cmd === 'help') {
        socket.emit('serverMessage', '/ses /me /emote /dance /role /stats /help');
        return;
      }
      return;
    }

    p.msg = text;
    p.messagesSent++;
    io.emit('playSound', 'msg');
    io.emit('newChatMessage', {
      name: p.name, text, color: p.color,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      role: p.role
    });
    setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].msg = ''; }, 5000);
  });

  socket.on('disconnect', () => {
    socket.leave('voice');
    io.to('voice').emit('voice-leave', socket.id);
    if (state.players[socket.id]) {
      const name = state.players[socket.id].name;
      delete state.players[socket.id];
      io.emit('playSound', 'leave');
      io.emit('serverMessage', `${name} ayrıldı`);
      io.emit('playerCount', Object.keys(state.players).length);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Neon Arena v4 → http://localhost:${PORT}`));
