const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
let coins = [];

// Haritadaki sabit engeller
const walls = [
    { x: 150, y: 120, w: 500, h: 20 },
    { x: 150, y: 440, w: 500, h: 20 },
    { x: 380, y: 220, w: 40, h: 160 }
];

// Rastgele 5 tane altın/yıldız oluştur
function spawnCoins() {
    while (coins.length < 5) {
        coins.push({
            id: Math.random(),
            x: Math.floor(Math.random() * 720) + 40,
            y: Math.floor(Math.random() * 520) + 40
        });
    }
}
spawnCoins();

function checkWallCollision(newX, newY) {
    const radius = 18;
    for (let w of walls) {
        if (
            newX + radius > w.x &&
            newX - radius < w.x + w.w &&
            newY + radius > w.y &&
            newY - radius < w.y + w.h
        ) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    players[socket.id] = {
        x: 100,
        y: 100,
        color: '#ff4757',
        avatar: '🐱',
        name: 'Oyuncu',
        score: 0,
        msg: '',
        emote: ''
    };

    socket.emit('init', { walls });
    io.emit('state', { players, coins });

    socket.on('joinGame', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name || 'Misafir';
            players[socket.id].color = data.color || '#ff4757';
            players[socket.id].avatar = data.avatar || '🐱';
            io.emit('state', { players, coins });
        }
    });

    socket.on('move', (dir) => {
        const p = players[socket.id];
        if (!p) return;
        const speed = 8;
        let nextX = p.x;
        let nextY = p.y;

        if (dir === 'UP') nextY = Math.max(25, p.y - speed);
        if (dir === 'DOWN') nextY = Math.min(575, p.y + speed);
        if (dir === 'LEFT') nextX = Math.max(25, p.x - speed);
        if (dir === 'RIGHT') nextX = Math.min(775, p.x + speed);

        if (!checkWallCollision(nextX, nextY)) {
            p.x = nextX;
            p.y = nextY;

            // Altın Toplama Kontrolü
            coins = coins.filter(coin => {
                const dist = Math.hypot(p.x - coin.x, p.y - coin.y);
                if (dist < 28) {
                    p.score += 10;
                    return false; // Altını haritadan kaldır
                }
                return true;
            });

            spawnCoins();
            io.emit('state', { players, coins });
        }
    });

    // Sohbet Mesajı
    socket.on('chat', (text) => {
        if (players[socket.id]) {
            players[socket.id].msg = text;
            io.emit('state', { players, coins });
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].msg = '';
                    io.emit('state', { players, coins });
                }
            }, 4000);
        }
    });

    // Emote (Hızlı İfade)
    socket.on('sendEmote', (emote) => {
        if (players[socket.id]) {
            players[socket.id].emote = emote;
            io.emit('state', { players, coins });
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].emote = '';
                    io.emit('state', { players, coins });
                }
            }, 2500);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('state', { players, coins });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
