const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Oyun Durumları (State)
const state = {
    chat: { players: {}, coins: [] },
    tank: { players: {}, bullets: [], enemies: [], wave: 1, enemiesToSpawn: 5 }
};

// --- YARDIMCI FONKSİYONLAR ---
function spawnEnemy() {
    state.tank.enemies.push({
        id: Math.random().toString(),
        x: Math.random() * 800,
        y: Math.random() < 0.5 ? -50 : 650, // Harita dışından gelsinler
        hp: 30 + (state.tank.wave * 10), // Wave arttıkça can artar
        speed: 2 + (state.tank.wave * 0.2)
    });
}

// --- SUNUCU OYUN DÖNGÜSÜ (TICK) - 30 FPS ---
setInterval(() => {
    // 1. Mermileri Güncelle
    for (let i = state.tank.bullets.length - 1; i >= 0; i--) {
        let b = state.tank.bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        
        // Ekran dışına çıkan mermiyi sil
        if (b.x < -50 || b.x > 850 || b.y < -50 || b.y > 650) {
            state.tank.bullets.splice(i, 1);
        }
    }

    // 2. Düşmanları Güncelle (En yakın oyuncuyu takip et)
    for (let i = state.tank.enemies.length - 1; i >= 0; i--) {
        let enemy = state.tank.enemies[i];
        
        // Hedef bul (En yakın oyuncu)
        let target = null;
        let minDist = Infinity;
        for (let pid in state.tank.players) {
            let p = state.tank.players[pid];
            let dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
            if (dist < minDist) { minDist = dist; target = p; }
        }

        if (target) {
            let angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
            enemy.x += Math.cos(angle) * enemy.speed;
            enemy.y += Math.sin(angle) * enemy.speed;
        }

        // Mermi - Düşman Çarpışma Kontrolü
        for (let j = state.tank.bullets.length - 1; j >= 0; j--) {
            let b = state.tank.bullets[j];
            if (Math.hypot(enemy.x - b.x, enemy.y - b.y) < 25) { // Vuruldu!
                enemy.hp -= b.damage;
                state.tank.bullets.splice(j, 1); // Mermiyi sil
                
                if (enemy.hp <= 0) {
                    // Düşman öldü
                    if (state.tank.players[b.ownerId]) {
                        state.tank.players[b.ownerId].score += 10;
                    }
                    state.tank.enemies.splice(i, 1);
                    break;
                }
            }
        }
    }

    // 3. Wave Kontrolü
    if (state.tank.enemies.length === 0 && Object.keys(state.tank.players).length > 0) {
        if (state.tank.enemiesToSpawn <= 0) {
            // WAVE BİTTİ - SONRAKİ AŞAMA KART SEÇİMİ OLACAK (Şimdilik direkt geçiyoruz)
            state.tank.wave++;
            state.tank.enemiesToSpawn = state.tank.wave * 5;
            io.to('tank').emit('waveComplete', state.tank.wave);
        } else {
            spawnEnemy();
            state.tank.enemiesToSpawn--;
        }
    }

    // Durumu odalara gönder
    io.to('chat').emit('gameState', state.chat);
    io.to('tank').emit('tankState', state.tank);

}, 1000 / 30); // Saniyede 30 kez


// --- SOCKET.IO BAĞLANTILARI ---
io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinGame', (data) => {
        currentRoom = data.mode; // 'chat' veya 'tank'
        socket.join(currentRoom);

        if (currentRoom === 'chat') {
            state.chat.players[socket.id] = { x: 400, y: 300, name: data.name, color: data.color, msg: '' };
        } else if (currentRoom === 'tank') {
            state.tank.players[socket.id] = { 
                x: 400, y: 300, name: data.name, color: data.color, 
                angle: 0, hp: 100, maxHp: 100, score: 0,
                attackSpeed: 500, damage: 20 // İleride kartlarla gelişecek
            };
        }
    });

    socket.on('move', (dir) => {
        let p = currentRoom === 'chat' ? state.chat.players[socket.id] : state.tank.players[socket.id];
        if (!p) return;
        
        let speed = currentRoom === 'tank' ? 5 : 8;
        if (dir === 'UP') p.y -= speed;
        if (dir === 'DOWN') p.y += speed;
        if (dir === 'LEFT') p.x -= speed;
        if (dir === 'RIGHT') p.x += speed;
    });

    // --- TANK MODU ÖZEL KOMUTLAR ---
    socket.on('mouseAim', (angle) => {
        if (currentRoom === 'tank' && state.tank.players[socket.id]) {
            state.tank.players[socket.id].angle = angle;
        }
    });

    socket.on('shoot', () => {
        if (currentRoom === 'tank' && state.tank.players[socket.id]) {
            let p = state.tank.players[socket.id];
            // Mermi oluştur
            state.tank.bullets.push({
                x: p.x + Math.cos(p.angle) * 30, // Namlunun ucundan çıksın
                y: p.y + Math.sin(p.angle) * 30,
                vx: Math.cos(p.angle) * 15, // Mermi hızı
                vy: Math.sin(p.angle) * 15,
                damage: p.damage,
                ownerId: socket.id
            });
        }
    });

    // --- SOHBET MODU ÖZEL KOMUTLAR ---
    socket.on('chat', (text) => {
        if (currentRoom === 'chat' && state.chat.players[socket.id]) {
            state.chat.players[socket.id].msg = text;
            setTimeout(() => {
                if (state.chat.players[socket.id]) state.chat.players[socket.id].msg = '';
            }, 4000);
        }
    });

    socket.on('disconnect', () => {
        if (state.chat.players[socket.id]) delete state.chat.players[socket.id];
        if (state.tank.players[socket.id]) delete state.tank.players[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
