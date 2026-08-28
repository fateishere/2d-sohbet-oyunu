const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const state = {
    players: {},
    map: { 
        width: 2500, 
        height: 2500,
        vents: [
            { id: 1, x: 200, y: 200 },
            { id: 2, x: 2300, y: 200 },
            { id: 3, x: 1250, y: 1250 },
            { id: 4, x: 200, y: 2300 },
            { id: 5, x: 2300, y: 2300 }
        ]
    }
};

// 60 FPS Kaymak Gibi Fizik Motoru
setInterval(() => {
    for (let id in state.players) {
        let p = state.players[id];
        if (p.inVent) continue; // Ventteyse hareket edemez

        // İvme uygula
        p.vx += p.moveX * p.speed;
        p.vy += p.moveY * p.speed;

        // Sürtünme (Friction) - Akıcı durma sağlar
        p.vx *= 0.85;
        p.vy *= 0.85;

        p.x += p.vx;
        p.y += p.vy;

        // Sınırlar
        if (p.x < 30) { p.x = 30; p.vx = 0; }
        if (p.x > state.map.width - 30) { p.x = state.map.width - 30; p.vx = 0; }
        if (p.y < 30) { p.y = 30; p.vy = 0; }
        if (p.y > state.map.height - 30) { p.y = state.map.height - 30; p.vy = 0; }
    }
    io.emit('gameState', state);
}, 1000 / 60);

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        state.players[socket.id] = {
            x: 1250, y: 1250, vx: 0, vy: 0, moveX: 0, moveY: 0,
            speed: 1.5,
            name: data.name.substring(0, 15) || 'Anonim Sörfçü',
            color: data.color,
            modelType: data.modelType,
            msg: '',
            isTyping: false,
            inVent: false,
            currentVent: null
        };
        socket.broadcast.emit('playSound', 'join');
    });

    // Vektörel (Yönlü) Hareket Alımı (Mobildeki Joystick ve PC için)
    socket.on('move', (vec) => {
        if (state.players[socket.id] && !state.players[socket.id].inVent) {
            state.players[socket.id].moveX = vec.x;
            state.players[socket.id].moveY = vec.y;
        }
    });

    // Vent Sistemi Kontrolü
    socket.on('toggleVent', () => {
        let p = state.players[socket.id];
        if (!p) return;

        if (p.inVent) {
            // Ventten Çık
            p.inVent = false;
            p.currentVent = null;
        } else {
            // En yakın venti bul ve gir
            let nearest = state.map.vents.find(v => Math.hypot(v.x - p.x, v.y - p.y) < 80);
            if (nearest) {
                p.inVent = true;
                p.currentVent = nearest.id;
                p.x = nearest.x;
                p.y = nearest.y;
                p.vx = 0; p.vy = 0;
            }
        }
    });

    socket.on('travelVent', (ventId) => {
        let p = state.players[socket.id];
        if (p && p.inVent) {
            let targetVent = state.map.vents.find(v => v.id === ventId);
            if (targetVent) {
                p.x = targetVent.x;
                p.y = targetVent.y;
                p.currentVent = targetVent.id;
            }
        }
    });

    // Sesli Sohbet (Voice Chat)
    socket.on('voiceStream', (audioData) => {
        // Gelen ses paketini diğer herkese yolla (kendi kendine yankı yapmaması için broadcast)
        socket.broadcast.emit('voiceStream', { id: socket.id, audio: audioData });
    });

    socket.on('chat', (text) => {
        if (!state.players[socket.id]) return;
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
server.listen(PORT, () => console.log(`60 FPS Sunucu Aktif: ${PORT}`));
