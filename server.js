const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// HTML dosyamızı sunmak için
app.use(express.static(path.join(__dirname, 'public')));

const players = {};

io.on('connection', (socket) => {
    console.log('Yeni bir oyuncu katıldı:', socket.id);

    // Rastgele renk ve başlangıç pozisyonu
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16);
    players[socket.id] = {
        x: Math.floor(Math.random() * 500) + 50,
        y: Math.floor(Math.random() * 300) + 50,
        color: randomColor,
        name: 'Oyuncu_' + socket.id.substr(0, 3),
        msg: ''
    };

    // Tüm oyunculara güncel listeyi gönder
    io.emit('state', players);

    // Yön tuşları veya WASD ile hareket
    socket.on('move', (dir) => {
        const p = players[socket.id];
        if (!p) return;
        const speed = 10;
        
        if (dir === 'UP') p.y = Math.max(20, p.y - speed);
        if (dir === 'DOWN') p.y = Math.min(580, p.y + speed);
        if (dir === 'LEFT') p.x = Math.max(20, p.x - speed);
        if (dir === 'RIGHT') p.x = Math.min(780, p.x + speed);

        io.emit('state', players);
    });

    // Mesaj geldiğinde
    socket.on('chat', (text) => {
        if (players[socket.id]) {
            players[socket.id].msg = text;
            io.emit('state', players);

            // 4 saniye sonra mesaj baloncuğu kaybolsun
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].msg = '';
                    io.emit('state', players);
                }
            }, 4000);
        }
    });

    // İsim Değiştirme
    socket.on('setName', (name) => {
        if (players[socket.id]) {
            players[socket.id].name = name;
            io.emit('state', players);
        }
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
        io.emit('state', players);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor! Tarayıcıdan http://localhost:${PORT} adresine gir.`);
});