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

const MAP = { width: 3200, height: 3200 };

const VENTS = [
  { id: 0, x: 450, y: 450, connections: [1, 2, 6] },
  { id: 1, x: 1550, y: 380, connections: [0, 3, 6] },
  { id: 2, x: 480, y: 1750, connections: [0, 4, 6] },
  { id: 3, x: 2650, y: 520, connections: [1, 5, 6] },
  { id: 4, x: 950, y: 2650, connections: [2, 5, 6] },
  { id: 5, x: 2550, y: 2450, connections: [3, 4, 6] },
  { id: 6, x: 1600, y: 1600, connections: [0, 1, 2, 3, 4, 5] } // merkez
];

const WALLS = [
  { x: 900, y: 900, w: 500, h: 45 },
  { x: 1900, y: 1100, w: 45, h: 600 },
  { x: 1100, y: 2100, w: 700, h: 45 },
  { x: 600, y: 1400, w: 45, h: 400 }
];

// Power-up spawn noktaları
const POWERUP_SPOTS = [
  { x: 800, y: 800 }, { x: 2400, y: 800 },
  { x: 800, y: 2400 }, { x: 2400, y: 2400 },
  { x: 1600, y: 900 }, { x: 1600, y: 2300 }
];

const state = {
  players: {},
  map: MAP,
  vents: VENTS,
  walls: WALLS,
  powerups: []
};

// Power-up spawn
function spawnPowerups() {
  state.powerups = POWERUP_SPOTS.map((s, i) => ({
    id: i,
    x: s.x,
    y: s.y,
    type: ['speed', 'glow', 'ghost'][Math.floor(Math.random() * 3)],
    active: true
  }));
}
spawnPowerups();
setInterval(spawnPowerups, 45000); // 45 sn'de bir yenile

const lastChat = {};
const lastInput = {};

// Ana oyun döngüsü (60 tick)
setInterval(() => {
  const now = Date.now();

  for (const id in state.players) {
    const p = state.players[id];
    if (p.inVent) continue;

    // Velocity uygula
    p.x += p.vx;
    p.y += p.vy;

    // Sürtünme (daha akıcı duruş)
    p.vx *= 0.82;
    p.vy *= 0.82;
    if (Math.abs(p.vx) < 0.15) p.vx = 0;
    if (Math.abs(p.vy) < 0.15) p.vy = 0;

    // Sınırlar
    p.x = Math.max(35, Math.min(MAP.width - 35, p.x));
    p.y = Math.max(35, Math.min(MAP.height - 35, p.y));

    // Duvar çarpışması
    for (const wall of WALLS) {
      if (p.x + 24 > wall.x && p.x - 24 < wall.x + wall.w &&
          p.y + 24 > wall.y && p.y - 24 < wall.y + wall.h) {
        // Basit geri itme
        const cx = wall.x + wall.w / 2;
        const cy = wall.y + wall.h / 2;
        const dx = p.x - cx;
        const dy = p.y - cy;
        if (Math.abs(dx) > Math.abs(dy)) {
          p.x += dx > 0 ? 8 : -8;
          p.vx = 0;
        } else {
          p.y += dy > 0 ? 8 : -8;
          p.vy = 0;
        }
      }
    }

    // Soft player collision
    for (const otherId in state.players) {
      if (otherId === id) continue;
      const o = state.players[otherId];
      if (o.inVent) continue;
      const dist = Math.hypot(p.x - o.x, p.y - o.y);
      if (dist < 52 && dist > 0) {
        const push = (52 - dist) * 0.15;
        const nx = (p.x - o.x) / dist;
        const ny = (p.y - o.y) / dist;
        p.x += nx * push;
        p.y += ny * push;
      }
    }

    // Power-up alma
    for (const pu of state.powerups) {
      if (!pu.active) continue;
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < 40) {
        pu.active = false;
        applyPowerup(p, pu.type);
        io.emit('serverMessage', `${p.name} ${pu.type.toUpperCase()} power-up aldı!`);
        io.to(id).emit('powerupTaken', pu.type);
      }
    }

    // Power-up süreleri
    if (p.speedUntil && now > p.speedUntil) {
      p.speedUntil = 0;
      p.maxSpeed = 9;
    }
    if (p.glowUntil && now > p.glowUntil) p.glowUntil = 0;
    if (p.ghostUntil && now > p.ghostUntil) p.ghostUntil = 0;
  }

  io.emit('gameState', state);
}, 1000 / 60);

function applyPowerup(p, type) {
  const now = Date.now();
  if (type === 'speed') {
    p.maxSpeed = 15;
    p.speedUntil = now + 12000;
  } else if (type === 'glow') {
    p.glowUntil = now + 15000;
  } else if (type === 'ghost') {
    p.ghostUntil = now + 8000;
  }
}

io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id);

  // ===== VOICE SIGNALING =====
  socket.on('voice-offer', (data) => {
    socket.to(data.to).emit('voice-offer', { from: socket.id, offer: data.offer });
  });
  socket.on('voice-answer', (data) => {
    socket.to(data.to).emit('voice-answer', { from: socket.id, answer: data.answer });
  });
  socket.on('voice-ice', (data) => {
    socket.to(data.to).emit('voice-ice', { from: socket.id, candidate: data.candidate });
  });
  socket.on('voice-join', () => {
    // Yeni gelen herkese mevcut oyuncuları bildir
    for (const id in state.players) {
      if (id !== socket.id) {
        socket.emit('voice-peer', id);
        io.to(id).emit('voice-peer', socket.id);
      }
    }
  });

  socket.on('joinGame', (data) => {
    if (!data || typeof data.name !== 'string') return;

    let name = data.name.trim().substring(0, 14) || 'Anonim';
    let finalName = name;
    let c = 1;
    while (Object.values(state.players).some(p => p.name === finalName)) {
      finalName = `${name}${c++}`;
    }

    state.players[socket.id] = {
      x: MAP.width / 2 + (Math.random() - 0.5) * 180,
      y: MAP.height / 2 + (Math.random() - 0.5) * 180,
      vx: 0, vy: 0,
      name: finalName,
      color: data.color || '#00d2ff',
      msg: '',
      isTyping: false,
      inVent: false,
      ventId: null,
      emote: null,
      maxSpeed: 9,
      speedUntil: 0,
      glowUntil: 0,
      ghostUntil: 0,
      joinedAt: Date.now()
    };

    socket.emit('init', {
      id: socket.id,
      vents: VENTS,
      walls: WALLS,
      map: MAP
    });

    socket.broadcast.emit('playSound', 'join');
    io.emit('serverMessage', `✦ ${finalName} evrene katıldı`);
    io.emit('playerCount', Object.keys(state.players).length);

    // Voice peer bildir
    socket.emit('voice-ready');
  });

  // Akıcı hareket: input vektörü al
  socket.on('input', (data) => {
    const p = state.players[socket.id];
    if (!p || p.inVent) return;

    const now = Date.now();
    if (lastInput[socket.id] && now - lastInput[socket.id] < 12) return;
    lastInput[socket.id] = now;

    let dx = data.dx || 0;
    let dy = data.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }

    const speed = p.maxSpeed || 9;
    p.vx = dx * speed;
    p.vy = dy * speed;
  });

  socket.on('typing', (status) => {
    if (state.players[socket.id]) state.players[socket.id].isTyping = !!status;
  });

  // ===== VENT =====
  socket.on('enterVent', (ventId) => {
    const p = state.players[socket.id];
    if (!p || p.inVent) return;

    const vent = VENTS.find(v => v.id === ventId);
    if (!vent) return;

    if (Math.hypot(p.x - vent.x, p.y - vent.y) > 90) return;

    p.inVent = true;
    p.ventId = ventId;
    p.vx = 0;
    p.vy = 0;
    p.msg = '';
    io.emit('serverMessage', `🌀 ${p.name} vent'e girdi`);
    socket.emit('playSound', 'vent');
  });

  socket.on('exitVent', (targetId) => {
    const p = state.players[socket.id];
    if (!p || !p.inVent) return;

    const current = VENTS.find(v => v.id === p.ventId);
    if (!current || !current.connections.includes(targetId)) return;

    const target = VENTS.find(v => v.id === targetId);
    if (!target) return;

    p.x = target.x;
    p.y = target.y;
    p.inVent = false;
    p.ventId = null;
    p.vx = 0;
    p.vy = 0;

    io.emit('serverMessage', `🌀 ${p.name} başka bir ventten çıktı`);
    socket.emit('playSound', 'vent');
  });

  socket.on('leaveVent', () => {
    const p = state.players[socket.id];
    if (!p || !p.inVent) return;
    p.inVent = false;
    p.ventId = null;
  });

  // ===== CHAT =====
  socket.on('chat', (text) => {
    const p = state.players[socket.id];
    if (!p || typeof text !== 'string') return;

    text = text.trim().substring(0, 140);
    if (!text) return;

    const now = Date.now();
    if (lastChat[socket.id] && now - lastChat[socket.id] < 700) return;
    lastChat[socket.id] = now;

    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === 'ses' && parts[1]) {
        io.emit('playCustomSound', parts[1]);
        io.emit('serverMessage', `🔊 ${p.name} özel ses açtı`);
        return;
      }
      if (cmd === 'me' && parts.slice(1).join(' ')) {
        io.emit('serverMessage', `* ${p.name} ${parts.slice(1).join(' ')}`);
        return;
      }
      if (cmd === 'emote' || cmd === 'e') {
        const emo = parts[1] || '😎';
        p.emote = emo.substring(0, 6);
        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].emote = null; }, 3500);
        return;
      }
      if (cmd === 'dance') {
        p.emote = '💃';
        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].emote = null; }, 4000);
        return;
      }
      if (cmd === 'help') {
        socket.emit('serverMessage', 'Komutlar: /ses <url> | /me <aksiyon> | /emote <emoji> | /dance | /help');
        return;
      }
      socket.emit('serverMessage', 'Bilinmeyen komut → /help');
      return;
    }

    p.msg = text;
    io.emit('playSound', 'msg');
    io.emit('newChatMessage', {
      name: p.name,
      text,
      color: p.color,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    });

    setTimeout(() => {
      if (state.players[socket.id]) state.players[socket.id].msg = '';
    }, 5200);
  });

  socket.on('disconnect', () => {
    if (state.players[socket.id]) {
      const name = state.players[socket.id].name;
      delete state.players[socket.id];
      io.emit('playSound', 'leave');
      io.emit('serverMessage', `${name} ayrıldı`);
      io.emit('playerCount', Object.keys(state.players).length);
      io.emit('voice-leave', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Neon Sohbet v3 → :${PORT}`));
