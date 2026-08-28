const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Harita, Duvarlar ve Ventler
const state = {
    players: {},
    map: { width: 2500, height: 2500 },
    vents: [
        { id: 0, x: 300, y: 300 },
        { id: 1, x: 2200, y: 300 },
        { id: 2, x: 300, y: 2200 },
        { id: 3, x: 2200, y: 2200 }
    ],
    walls: [
        { x: 600, y: 500, w: 200, h: 50 },
        { x: 1200, y: 800, w: 50, h: 400 },
        { x: 500, y: 1500, w: 600, h: 50 },
        { x: 1800, y: 1000, w: 50, h: 600 }
    ]
};

// Çarpışma Kontrolü (AABB)
function checkCollision(nx, ny) {
    const pSize = 25; // Oyuncu yarıçapı
    for (let w of state.walls) {
        if (nx + pSize > w.x && nx - pSize < w.x + w.w &&
            ny + pSize > w.y && ny - pSize < w.y + w.h) {
            return true;
        }
    }
    return false;
}

// Oyun Döngüsü
setInterval(() => {
    io.emit('gameState', state);
}, 1000 / 30);

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        state.players[socket.id] = {
            x: 1250, y: 1250,
            name: data.name.substring(0, 15) || 'Anonim',
            color: data.color,
            msg: '', emote: '',
            isTyping: false,
            isVenting: false, currentVent: -1
        };
        socket.broadcast.emit('playSound', 'join');
    });

    socket.on('move', (data) => {
        let p = state.players[socket.id];
        if (!p || p.isVenting) return; // Ventteyken hareket edilemez
        
        let speed = data.sprint ? 14 : 7;
        let nx = p.x, ny = p.y;

        if (data.dir === 'UP') ny -= speed;
        if (data.dir === 'DOWN') ny += speed;
        if (data.dir === 'LEFT') nx -= speed;
        if (data.dir === 'RIGHT') nx += speed;

        // Harita Sınırları
        if (nx < 25) nx = 25;
        if (nx > state.map.width - 25) nx = state.map.width - 25;
        if (ny < 25) ny = 25;
        if (ny > state.map.height - 25) ny = state.map.height - 25;

        // Duvar Çarpışması
        if (!checkCollision(nx, p.y)) p.x = nx;
        if (!checkCollision(p.x, ny)) p.y = ny;
    });

    // --- VENT SİSTEMİ ---
    socket.on('interactVent', () => {
        let p = state.players[socket.id];
        if (!p) return;

        if (p.isVenting) {
            // Ventten Çık
            p.isVenting = false;
            let currentVent = state.vents[p.currentVent];
            p.x = currentVent.x; p.y = currentVent.y + 40;
            p.currentVent = -1;
            io.emit('playSound', 'vent');
        } else {
            // Vente Gir (En yakın venti bul)
            for (let i = 0; i < state.vents.length; i++) {
                let v = state.vents[i];
                let dist = Math.hypot(p.x - v.x, p.y - v.y);
                if (dist < 80) { // Vente yeterince yakınsa
                    p.isVenting = true;
                    p.currentVent = i;
                    p.x = v.x; p.y = v.y; // Oyuncuyu ventin merkezine al
                    io.emit('playSound', 'vent');
                    break;
                }
            }
        }
    });

    socket.on('switchVent', (direction) => {
        let p = state.players[socket.id];
        if (!p || !p.isVenting) return;
        
        if (direction === 'next') p.currentVent = (p.currentVent + 1) % state.vents.length;
        if (direction === 'prev') p.currentVent = (p.currentVent - 1 + state.vents.length) % state.vents.length;
        
        let newVent = state.vents[p.currentVent];
        p.x = newVent.x; p.y = newVent.y;
    });

    // --- EMOTE & SOHBET ---
    socket.on('emote', (emo) => {
        if (!state.players[socket.id]) return;
        state.players[socket.id].emote = emo;
        setTimeout(() => { if(state.players[socket.id]) state.players[socket.id].emote = ''; }, 3000);
    });

    socket.on('typing', (status) => { if(state.players[socket.id]) state.players[socket.id].isTyping = status; });

    socket.on('chat', (text) => {
        if (!state.players[socket.id]) return;
        
        if (text.startsWith('/ses ')) {
            const url = text.split(' ')[1];
            if (url) {
                io.emit('playCustomSound', url);
                io.emit('serverMessage', `🎵 ${state.players[socket.id].name} bir şarkı açtı!`);
            }
            return;
        }

        state.players[socket.id].msg = text;
        io.emit('playSound', 'msg');
        io.emit('newChatMessage', { name: state.players[socket.id].name, text: text, color: state.players[socket.id].color });

        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].msg = ''; }, 5000);
    });

    socket.on('disconnect', () => {
        if (state.players[socket.id]) {
            io.emit('playSound', 'leave');
            delete state.players[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`V3 Sunucu aktif: ${PORT}`));
