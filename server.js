const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Gelişmiş Oyun Durumu
const state = {
    players: {},
    map: { width: 2000, height: 2000 } // Artık devasa bir haritamız var
};

// Saniyede 30 kez çalışan ana motor
setInterval(() => {
    io.emit('gameState', state);
}, 1000 / 30);

io.on('connection', (socket) => {
    console.log('Yeni oyuncu bağlandı:', socket.id);

    socket.on('joinGame', (data) => {
        // Oyuncuyu haritanın ortasında başlat
        state.players[socket.id] = {
            x: state.map.width / 2,
            y: state.map.height / 2,
            name: data.name.substring(0, 15) || 'Anonim',
            color: data.color,
            msg: '',
            isTyping: false
        };
        // Herkese yeni birinin katıldığını bildir (Ses çalmak için)
        socket.broadcast.emit('playSound', 'join');
    });

    socket.on('move', (dir) => {
        let p = state.players[socket.id];
        if (!p) return;
        
        let speed = 10;
        if (dir === 'UP') p.y -= speed;
        if (dir === 'DOWN') p.y += speed;
        if (dir === 'LEFT') p.x -= speed;
        if (dir === 'RIGHT') p.x += speed;

        // Harita dışına çıkmayı engelle (Sınır Çarpışma Testi)
        if (p.x < 20) p.x = 20;
        if (p.x > state.map.width - 20) p.x = state.map.width - 20;
        if (p.y < 20) p.y = 20;
        if (p.y > state.map.height - 20) p.y = state.map.height - 20;
    });

    socket.on('typing', (status) => {
        if (state.players[socket.id]) state.players[socket.id].isTyping = status;
    });

    socket.on('chat', (text) => {
        if (!state.players[socket.id]) return;
        
        // ÖZEL KOMUT SİSTEMİ: /ses <link>
        if (text.startsWith('/ses ')) {
            const url = text.split(' ')[1];
            if (url) {
                io.emit('playCustomSound', url); // Tüm oyunculara bu sesi çalmasını emret
                io.emit('serverMessage', `${state.players[socket.id].name} bir ses açtı!`);
            }
            return;
        }

        // Normal Mesaj
        state.players[socket.id].msg = text;
        io.emit('playSound', 'msg'); // Herkese mesaj sesi çal
        io.emit('newChatMessage', { name: state.players[socket.id].name, text: text, color: state.players[socket.id].color });

        setTimeout(() => {
            if (state.players[socket.id]) state.players[socket.id].msg = '';
        }, 5000); // Mesaj 5 saniye kafasında kalsın
    });

    socket.on('disconnect', () => {
        if (state.players[socket.id]) {
            io.emit('playSound', 'leave');
            delete state.players[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Gelişmiş Sunucu aktif: ${PORT}`));
