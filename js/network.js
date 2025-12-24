// js/network.js

let lastSentTime = 0;
let peer = null;
let conn = null;
let isHost = false;
let isOnline = false;
let myId = null;

// Biến chứa Input của Client gửi lên (để Host điều khiển P2)
let networkInputP2 = { up: false, down: false, left: false, right: false, shoot: false };

// --- 1. KHỞI TẠO & KẾT NỐI ---

function initNetwork() {
    const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    peer = new Peer(randomId, {
        debug: 1
    });

    peer.on('open', (id) => {
        myId = id;
        console.log('My peer ID is: ' + id);
        const idBox = document.getElementById('myRoomId');
        if(idBox) idBox.innerText = id;
    });

    peer.on('connection', (c) => {
        if(conn) { c.close(); return; } 
        
        conn = c;
        isHost = true;
        isOnline = true;
        
        document.getElementById('hostStatus').style.display = 'block';
        document.getElementById('hostStatus').innerText = "PLAYER CONNECTED! STARTING GAME...";
        
        setupConnectionHandlers();
        
        setTimeout(() => {
            window.selectMap('day'); 
            window.startGame();
        }, 1000);
    });

    peer.on('error', (err) => {
        console.error(err);
        alert("Network Error: " + err.type);
    });
}

function joinRoom() {
    const destId = document.getElementById('joinInput').value.trim().toUpperCase();
    if(!destId) { alert("Please enter a Room ID!"); return; }
    
    if(!peer) {
         const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
         peer = new Peer(randomId);
         peer.on('open', () => { connectToPeer(destId); });
    } else {
        connectToPeer(destId);
    }
}

function connectToPeer(destId) {
    conn = peer.connect(destId);
    isHost = false;
    isOnline = true;
    setupConnectionHandlers();
}

function setupConnectionHandlers() {
    conn.on('open', () => {
        console.log("Connected!");
        if(!isHost) {
            document.getElementById('onlineModal').innerHTML = "<br><br><h2 style='color:#00ffff'>CONNECTED!</h2><p>Waiting for Host to start...</p>";
             isNightMode = false; 
             isDeathmatch = false; 
        }
    });

    conn.on('data', (data) => {
        handleNetworkData(data);
    });

    conn.on('close', () => {
        alert("Connection lost! Returning to menu.");
        location.reload();
    });
    
    conn.on('error', (err) => { console.error("Conn Error:", err); });
}

// --- 2. XỬ LÝ DỮ LIỆU NHẬN ĐƯỢC ---

function handleNetworkData(data) {
    if (isHost) {
        if (data.type === 'INPUT') {
            networkInputP2 = data.state;
        }
    } else {
        if (data.type === 'STATE') {
            applyGameState(data);
        }
        else if (data.type === 'START') {
             hideAllMenus();
             document.getElementById('onlineModal').style.display = 'none';
             document.getElementById('bottomBar').style.display = 'flex';
             gameRunning = true;
             document.getElementById('gameMessage').style.display = 'none';
             document.getElementById('s1').innerText="0"; 
             document.getElementById('s2').innerText="0";
             if(animationId) cancelAnimationFrame(animationId);
             loop(); 
        }
        else if (data.type === 'MAP_DATA') {
            document.getElementById('gameMessage').style.display = 'none';
            walls = data.walls;
            wallPath = new Path2D();
            for(let w of walls) { wallPath.rect(w.x, w.y, w.w, w.h); }
            if(data.spawns) {
                p1.startX = data.spawns.p1.x; p1.startY = data.spawns.p1.y;
                p2.startX = data.spawns.p2.x; p2.startY = data.spawns.p2.y;
                p1.reset(); p2.reset();
            }
            if(data.barrels) {
                barrels = [];
                data.barrels.forEach(b => barrels.push(new Barrel(b.x, b.y)));
            }
        }
        else if (data.type === 'WALL_BREAK') {
            if(window.destroyWall) window.destroyWall(data.index, true); // true: là lệnh mạng
        }
        else if (data.type === 'VFX') {
            handleVFX(data);
        }
        // XỬ LÝ KẾT QUẢ TRẬN ĐẤU (UI SYNC)
        else if (data.type === 'ROUND_END') {
            const msgBox = document.getElementById('gameMessage');
            msgBox.innerText = data.text;
            msgBox.style.color = data.color;
            msgBox.style.display = "block";
        }
    }
}

function handleVFX(data) {
    if (data.kind === 'explosion') {
        if (window.createExplosion) window.createExplosion(data.x, data.y, data.color, data.big, true);
    }
    else if (data.kind === 'hit') {
        if (window.createHitEffect) window.createHitEffect(data.x, data.y, data.color, true);
    }
}

// --- 3. CÁC HÀM GỬI DỮ LIỆU (SYNC) ---

function sendGameState() {
    if (!isHost || !conn || !conn.open) return;
    
    const now = Date.now();
    if (now - lastSentTime < NETWORK_TICK_DELAY) return;
    lastSentTime = now;
    
    const state = {
        type: 'STATE',
        p1: { 
            x: Math.round(p1.x), 
            y: Math.round(p1.y), 
            a: parseFloat(p1.angle.toFixed(2)), 
            dead: p1.dead, 
            hp: p1.hp,
            s: p1.activeShield,
            w: p1.weaponType,
            // [QUAN TRỌNG] Gửi thêm đạn để UI client cập nhật
            am: p1.ammo,
            mam: p1.maxAmmo
        },
        p2: { 
            x: Math.round(p2.x), 
            y: Math.round(p2.y), 
            a: parseFloat(p2.angle.toFixed(2)), 
            dead: p2.dead, 
            hp: p2.hp,
            s: p2.activeShield,
            w: p2.weaponType,
            // [QUAN TRỌNG] Gửi thêm đạn để UI client cập nhật
            am: p2.ammo,
            mam: p2.maxAmmo
        },
        b: bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), t: b.type, c: b.color })),
        pu: powerups.filter(p => p.active).map(p => ({ x: Math.round(p.x), y: Math.round(p.y), t: p.type })),
        s: { s1: scores.p1, s2: scores.p2 } 
    };
    conn.send(state);
}

function sendClientInput() {
    if (isHost || !conn || !conn.open) return;
    const input = {
        up: keys['ArrowUp'] || keys['KeyW'] || keys['KeyE'],
        down: keys['ArrowDown'] || keys['KeyS'] || keys['KeyD'],
        left: keys['ArrowLeft'] || keys['KeyA'] || keys['KeyS'],
        right: keys['ArrowRight'] || keys['KeyD'] || keys['KeyF'],
        shoot: keys['KeyK'] || keys['Space'] || keys['KeyQ'] || keys['Enter']
    };
    conn.send({ type: 'INPUT', state: input });
}

function sendMapData() {
    if (!isHost || !conn || !conn.open) return;
    conn.send({
        type: 'MAP_DATA',
        walls: walls, 
        barrels: barrels.map(b => ({x: b.x, y: b.y})), 
        spawns: { p1: {x: p1.startX, y: p1.startY}, p2: {x: p2.startX, y: p2.startY} }
    });
}

function sendWallBreak(index) {
    if (!isHost || !conn || !conn.open) return;
    conn.send({ type: 'WALL_BREAK', index: index });
}

function sendVFX(kind, x, y, color, big = false) {
    if (!isHost || !conn || !conn.open) return;
    conn.send({ type: 'VFX', kind: kind, x: Math.round(x), y: Math.round(y), color: color, big: big });
}

function applyGameState(data) {
    if (!p1 || !p2) return;
    
    // Cập nhật P1
    p1.targetX = data.p1.x; p1.targetY = data.p1.y; p1.targetAngle = data.p1.a; 
    p1.dead = data.p1.dead; p1.hp = data.p1.hp; p1.activeShield = data.p1.s;
    if (data.p1.w) p1.weaponType = data.p1.w;
    // [MỚI] Nhận dữ liệu đạn
    if (data.p1.am !== undefined) { p1.ammo = data.p1.am; p1.maxAmmo = data.p1.mam; }
    p1.updateHPUI();
    
    // Cập nhật P2
    p2.targetX = data.p2.x; p2.targetY = data.p2.y; p2.targetAngle = data.p2.a;
    p2.dead = data.p2.dead; p2.hp = data.p2.hp; p2.activeShield = data.p2.s;
    if (data.p2.w) p2.weaponType = data.p2.w;
    // [MỚI] Nhận dữ liệu đạn
    if (data.p2.am !== undefined) { p2.ammo = data.p2.am; p2.maxAmmo = data.p2.mam; }
    p2.updateHPUI();
    
    // Score Sync
    if(scores.p1 !== data.s.s1 || scores.p2 !== data.s.s2) {
        scores.p1 = data.s.s1; scores.p2 = data.s.s2;
        document.getElementById('s1').innerText = scores.p1;
        document.getElementById('s2').innerText = scores.p2;
    }

    // Bullet & Powerup Sync
    bullets = [];
    if(data.b && data.b.length > 0) {
        data.b.forEach(bData => { bullets.push(new Bullet(bData.x, bData.y, 0, bData.c, bData.t, null)); });
    }
    powerups = [];
    if(data.pu && data.pu.length > 0) {
        data.pu.forEach(pData => { powerups.push(new PowerUp(pData.x, pData.y, pData.t)); });
    }
}

function openOnlineMenu() {
    hideAllMenus();
    document.getElementById('onlineModal').style.display = 'flex';
    if(!peer) initNetwork();
}

function closeOnlineMenu() {
    document.getElementById('onlineModal').style.display = 'none';
    document.getElementById('menuOverlay').style.display = 'flex';
}

// [SỬA LỖI] Hàm này trước đây bị lỗi cú pháp
function sendRoundEnd(text, color) {
    if (!isHost || !conn || !conn.open) return;
    conn.send({
        type: 'ROUND_END',
        text: text,
        color: color
    });
}

// Export functions to global scope
window.joinRoom = joinRoom;
window.openOnlineMenu = openOnlineMenu;
window.closeOnlineMenu = closeOnlineMenu;
window.sendMapData = sendMapData;
window.sendGameState = sendGameState;
window.sendClientInput = sendClientInput;
window.sendWallBreak = sendWallBreak;
window.sendVFX = sendVFX; 
window.sendRoundEnd = sendRoundEnd;