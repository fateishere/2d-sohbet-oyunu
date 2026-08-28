const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== HARİTA & VENTLER ====================
const MAP = { width: 3000, height: 3000 };

// Among Us tarzı vent ağı
const VENTS = [
  { id: 0, x: 400, y: 400, connections: [1, 2] },
  { id: 1, x: 1400, y: 350, connections: [0, 3] },
  { id: 2, x: 500, y: 1600, connections: [0, 4] },
  { id: 3, x: 2500, y: 500, connections: [1, 5] },
  { id: 4, x: 900, y: 2500, connections: [2, 5] },
  { id: 5, x: 2400, y: 2300, connections: [3, 4] },
  { id: 6, x: 1500, y: 1500, connections: [0, 1, 2, 3, 4, 5] } // merkezi vent
];

// Engel / duvar örnekleri (basit dikdörtgenler)
const WALLS = [
  { x: 800, y: 800, w: 400, h: 40 },
  { x: 1800, y: 1200, w: 40, h: 500 },
  { x: 1000, y: 2000, w: 600, h: 40 }
];

const state = {
  players: {},
  map: MAP,
  vents: VENTS,
  walls: WALLS
};

// Anti-spam
const lastChat = {};
const lastMove = {};

setInterval(() => {
  io.emit('gameState', state);
}, 1000 / 30);

io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id);

  socket.on('joinGame', (data) => {
    if (!data || typeof data.name !== 'string') return;

    const name = data.name.trim().substring(0, 15) || 'Anonim';
    const color = data.color || '#00d2ff';

    // Aynı isim varsa numara ekle
    let finalName = name;
    let counter = 1;
    while (Object.values(state.players).some(p => p.name === finalName)) {
      finalName = `${name}${counter++}`;
    }

    state.players[socket.id] = {
      x: MAP.width / 2 + (Math.random() * 200 - 100),
      y: MAP.height / 2 + (Math.random() * 200 - 100),
      name: finalName,
      color,
      msg: '',
      isTyping: false,
      inVent: false,
      ventId: null,
      emote: null,
      lastEmote: 0,
      speedBoost: false
    };

    socket.emit('init', { id: socket.id, vents: VENTS, walls: WALLS });
    socket.broadcast.emit('playSound', 'join');
    io.emit('serverMessage', `${finalName} evrene katıldı!`);
    io.emit('playerCount', Object.keys(state.players).length);
  });

  socket.on('move', (dir) => {
    const p = state.players[socket.id];
    if (!p || p.inVent) return;

    const now = Date.now();
    if (lastMove[socket.id] && now - lastMove[socket.id] < 25) return;
    lastMove[socket.id] = now;

    let speed = p.speedBoost ? 16 : 9;

    if (dir === 'UP') p.y -= speed;
    if (dir === 'DOWN') p.y += speed;
    if (dir === 'LEFT') p.x -= speed;
    if (dir === 'RIGHT') p.x += speed;

    // Sınırlar
    p.x = Math.max(30, Math.min(MAP.width - 30, p.x));
    p.y = Math.max(30, Math.min(MAP.height - 30, p.y));

    // Duvar çarpışması (basit AABB)
    for (const wall of WALLS) {
      if (p.x + 25 > wall.x && p.x - 25 < wall.x + wall.w &&
          p.y + 25 > wall.y && p.y - 25 < wall.y + wall.h) {
        // Geri it
        if (dir === 'UP') p.y += speed;
        if (dir === 'DOWN') p.y -= speed;
        if (dir === 'LEFT') p.x += speed;
        if (dir === 'RIGHT') p.x -= speed;
      }
    }
  });

  socket.on('sprint', (active) => {
    if (state.players[socket.id]) {
      state.players[socket.id].speedBoost = !!active;
    }
  });

  socket.on('typing', (status) => {
    if (state.players[socket.id]) {
      state.players[socket.id].isTyping = !!status;
    }
  });

  // ===== VENT SİSTEMİ =====
  socket.on('enterVent', (ventId) => {
    const p = state.players[socket.id];
    if (!p || p.inVent) return;

    const vent = VENTS.find(v => v.id === ventId);
    if (!vent) return;

    const dist = Math.hypot(p.x - vent.x, p.y - vent.y);
    if (dist > 80) return; // yeterince yakın değil

    p.inVent = true;
    p.ventId = ventId;
    p.msg = '';
    io.emit('serverMessage', `${p.name} bir vent'e girdi...`);
  });

  socket.on('exitVent', (targetVentId) => {
    const p = state.players[socket.id];
    if (!p || !p.inVent) return;

    const current = VENTS.find(v => v.id === p.ventId);
    if (!current || !current.connections.includes(targetVentId)) return;

    const target = VENTS.find(v => v.id === targetVentId);
    if (!target) return;

    p.x = target.x;
    p.y = target.y;
    p.inVent = false;
    p.ventId = null;

    io.emit('serverMessage', `${p.name} başka bir yerden çıktı!`);
    socket.emit('playSound', 'vent');
  });

  socket.on('leaveVent', () => {
    const p = state.players[socket.id];
    if (!p || !p.inVent) return;
    p.inVent = false;
    p.ventId = null;
  });

  // ===== SOHBET & KOMUTLAR =====
  socket.on('chat', (text) => {
    const p = state.players[socket.id];
    if (!p || typeof text !== 'string') return;

    text = text.trim().substring(0, 120);
    if (!text) return;

    // Anti-spam
    const now = Date.now();
    if (lastChat[socket.id] && now - lastChat[socket.id] < 800) return;
    lastChat[socket.id] = now;

    // Komutlar
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();

      if (cmd === 'ses' && parts[1]) {
        io.emit('playCustomSound', parts[1]);
        io.emit('serverMessage', `${p.name} özel bir ses açtı!`);
        return;
      }

      if (cmd === 'me' && parts.slice(1).join(' ')) {
        io.emit('serverMessage', `* ${p.name} ${parts.slice(1).join(' ')}`);
        return;
      }

      if (cmd === 'emote' && parts[1]) {
        p.emote = parts[1].substring(0, 8);
        p.lastEmote = Date.now();
        setTimeout(() => {
          if (state.players[socket.id]) state.players[socket.id].emote = null;
        }, 3000);
        return;
      }

      if (cmd === 'help') {
        socket.emit('serverMessage', 'Komutlar: /ses <url> | /me <aksiyon> | /emote <emoji> | /help');
        return;
      }

      socket.emit('serverMessage', 'Bilinmeyen komut. /help yaz.');
      return;
    }

    // Normal mesaj
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
    }, 5500);
  });

  socket.on('disconnect', () => {
    if (state.players[socket.id]) {
      const name = state.players[socket.id].name;
      delete state.players[socket.id];
      io.emit('playSound', 'leave');
      io.emit('serverMessage', `${name} ayrıldı.`);
      io.emit('playerCount', Object.keys(state.players).length);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Neon Sohbet aktif → http://localhost:${PORT}`);
});
