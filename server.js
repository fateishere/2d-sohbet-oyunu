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
        width: 3000, 
        height: 3000,
        vents: [
            { id: 1, x: 300, y: 300, name: "Kuzey-Batı Reaktörü" },
            { id: 2, x: 2700, y: 300, name: "Kuzey-Doğu Gözlem" },
            { id: 3, x: 1500, y: 1500, name: "Merkez Çekirdek" },
            { id: 4, x: 300, y: 2700, name: "Güney-Batı Depo" },
            { id: 5, x: 2700, y: 2700, name: "Güney-Doğu Hangar" }
        ]
    }
};

setInterval(() => {
    for (let id in state.players) {
        let p = state.players[id];
        if (p.inVent) continue; 

        p.vx += p.moveX * p.speed;
        p.vy += p.moveY * p.speed;

        p.vx *= 0.82; // Sürtünme artırıldı (daha kontrollü kayış)
        p.vy *= 0.82;

        p.x += p.vx;
        p.y += p.vy;

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
            x: 1500, y: 1500, vx: 0, vy: 0, moveX: 0, moveY: 0,
            speed: 1.8, // Hız artırıldı
            name: data.name.substring(0, 15) || 'Anonim Sörfçü',
            color: data.color,
            modelType: data.modelType,
            msg: '',
            isSpeaking: false,
            inVent: false,
            currentVent: null
        };
    });

    socket.on('move', (vec) => {
        if (state.players[socket.id] && !state.players[socket.id].inVent) {
            state.players[socket.id].moveX = vec.x;
            state.players[socket.id].moveY = vec.y;
        }
    });

    socket.on('toggleVent', () => {
        let p = state.players[socket.id];
        if (!p) return;

        if (p.inVent) {
            p.inVent = false;
            p.currentVent = null;
        } else {
            let nearest = state.map.vents.find(v => Math.hypot(v.x - p.x, v.y - p.y) < 100);
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
                // Işınlanma efekti için sunucudan tetik gönderiyoruz
                io.emit('ventEffect', { x: p.x, y: p.y, color: p.color });
            }
        }
    });

    // Optimize Edilmiş Mic Sistemi
    socket.on('voiceStream', (audioData) => {
        if (state.players[socket.id]) {
            state.players[socket.id].isSpeaking = true;
            socket.broadcast.emit('voiceStream', { id: socket.id, audio: audioData });
            
            // Konuşma simgesini kapatmak için zamanlayıcı (chunk gelmezse kapanır)
            clearTimeout(socket.speakTimer);
            socket.speakTimer = setTimeout(() => {
                if(state.players[socket.id]) state.players[socket.id].isSpeaking = false;
            }, 500);
        }
    });

    socket.on('chat', (text) => {
        if (!state.players[socket.id]) return;
        state.players[socket.id].msg = text;
        io.emit('newChatMessage', { name: state.players[socket.id].name, text: text, color: state.players[socket.id].color });
        setTimeout(() => { if (state.players[socket.id]) state.players[socket.id].msg = ''; }, 5000);
    });

    socket.on('disconnect', () => {
        if (state.players[socket.id]) delete state.players[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Gelişmiş Sunucu Aktif: ${PORT}`));
