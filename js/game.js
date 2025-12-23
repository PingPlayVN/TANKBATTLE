// --- KHỞI TẠO CANVAS PHỤ CHO HIỆU ỨNG BÓNG TỐI (OFF-SCREEN CANVAS) ---
const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = 1365;
shadowCanvas.height = 780;
const shadowCtx = shadowCanvas.getContext('2d');

// --- TẠO TEXTURE BỤI (NOISE) ---
const noiseCanvas = document.createElement('canvas');
const noiseSize = 256; 
noiseCanvas.width = noiseSize; 
noiseCanvas.height = noiseSize;
const noiseCtx = noiseCanvas.getContext('2d');

function generateNoiseTexture() {
    noiseCtx.clearRect(0, 0, noiseSize, noiseSize);
    noiseCtx.fillStyle = "rgba(0, 0, 0, 0.0)";
    noiseCtx.fillRect(0, 0, noiseSize, noiseSize);
    
    // [CỰC KỲ MỜ]: Bụi chỉ còn mức 0.01 để không làm đục ánh sáng
    for (let i = 0; i < 1500; i++) {
        let x = Math.random() * noiseSize;
        let y = Math.random() * noiseSize;
        let alpha = Math.random() * 0.01; 
        noiseCtx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
        noiseCtx.fillRect(x, y, 1, 1);
    }
}
generateNoiseTexture();

// --- HELPER PHYSICS ---
// CẬP NHẬT: Hàm checkWallCollision giờ đây kiểm tra cả thùng TNT (hình vuông)
function checkWallCollision(x, y, radius) {
    // 1. Check tường (Hình chữ nhật)
    for (let w of walls) { 
        if (circleRectCollide(x, y, radius, w.x, w.y, w.w, w.h)) return true; 
    } 
    
    // 2. Check thùng TNT (Hình vuông)
    for (let b of barrels) {
        if (b.active) {
            let size = b.radius * 2;
            let left = b.x - b.radius;
            let top = b.y - b.radius;
            // Coi thùng như một bức tường hình vuông
            if (circleRectCollide(x, y, radius, left, top, size, size)) return true;
        }
    }

    return false; 
}

function calculateBounce(x, y, vx, vy, radius) {
    let hitX = checkWallCollision(x + vx, y, radius);
    if (hitX) { vx = -vx; }
    let hitY = checkWallCollision(x, y + vy, radius);
    if (hitY) { vy = -vy; }
    return { vx, vy, hit: hitX || hitY };
}

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- AI SYSTEM ---
function updateAI(ai, opponent) {
    if(ai.dead || opponent.dead) return;
    const diff = AI_DIFFICULTY[aiConfig.difficulty] || AI_DIFFICULTY.EASY;
    const persona = AI_PERSONALITY[aiConfig.personality] || AI_PERSONALITY.BALANCED;

    ai.aiReactionCounter++;
    if (ai.aiReactionCounter < diff.reaction) {
        ai.currentVx *= 0.8; ai.currentVy *= 0.8;
        if(!checkWallCollision(ai.x + ai.currentVx, ai.y + ai.currentVy, ai.hitbox)) { 
            ai.x += ai.currentVx; ai.y += ai.currentVy; 
        }
        return;
    }
    ai.aiReactionCounter = 0;

    let dodgeMove = getDodgeVector(ai, bullets, walls);
    let isDodging = false;
    let moveTarget = {x: opponent.x, y: opponent.y}; 

    if (dodgeMove.active) {
        let dodgeAngle = Math.atan2(dodgeMove.y, dodgeMove.x);
        ai.aiMode = 'DODGE';
        isDodging = true;
        rotateTowards(ai, dodgeAngle, 0.3);
        let speed = (ai.activeShield ? 3.5 : diff.moveSpeed) * 1.2;
        ai.currentVx = Math.cos(ai.angle) * speed; 
        ai.currentVy = Math.sin(ai.angle) * speed;
        
        let canMoveX = !checkWallCollision(ai.x + ai.currentVx, ai.y, ai.hitbox);
        let canMoveY = !checkWallCollision(ai.x, ai.y + ai.currentVy, ai.hitbox);
        if(canMoveX) ai.x += ai.currentVx;
        if(canMoveY) ai.y += ai.currentVy;
        ai.drawTracks();
        if (Math.random() < 0.8) return; 
    }

    if (!isDodging) {
        if (ai.aiAimLockTimer > 0) {
            ai.aiAimLockTimer--;
            let error = (Math.random() - 0.5) * diff.aimErr;
            rotateTowards(ai, ai.aiIdealAngle + error, 0.25); 
            if (ai.aiAimLockTimer <= 0 || Math.abs(ai.aiIdealAngle - ai.angle) < 0.1) { 
                let muzzleDist = 20; 
                let tipX = ai.x + Math.cos(ai.angle) * muzzleDist;
                let tipY = ai.y + Math.sin(ai.angle) * muzzleDist;
                if (!checkWallCollision(tipX, tipY, 2)) {
                    ai.shoot(walls); 
                }
                ai.aiMode = 'SEEK'; 
            }
            return; 
        }

        if (ai.ammo > 0 && ai.cooldownTimer <= 0) {
            if (ai.weaponType === 'FLAME') {
                let d = dist(ai.x, ai.y, opponent.x, opponent.y);
                if (d < 160 && hasLineOfSight(ai.x, ai.y, opponent.x, opponent.y)) {
                    ai.aiIdealAngle = Math.atan2(opponent.y - ai.y, opponent.x - ai.x);
                    ai.aiAimLockTimer = 5; ai.aiMode = 'AIM_LOCK'; return;
                }
            } else {
                let magicAngle = findFiringSolution(ai, opponent, diff.bounces);
                if (magicAngle !== null) { 
                    ai.aiIdealAngle = magicAngle; 
                    ai.aiAimLockTimer = 15; 
                    ai.aiMode = 'AIM_LOCK'; 
                    return; 
                }
            }
        }
    }

    if (!isDodging) {
        let shouldMove = true;
        if (persona.type === 'camper' && ai.weaponType !== 'NORMAL' && ai.ammo > 0 && Math.random() < 0.95) shouldMove = false;
        
        if (ai.weaponType === 'NORMAL' || ai.ammo <= 1 || persona.type === 'rusher') {
            let minP = 9999, bestP = null;
            for(let p of powerups) { 
                if(p.active) { 
                    let d = dist(ai.x, ai.y, p.x, p.y); 
                    if(d < minP) { minP = d; bestP = p; } 
                } 
            }
            if (bestP) {
                if (persona.type === 'rusher' && dist(ai.x, ai.y, opponent.x, opponent.y) < 200) moveTarget = {x: opponent.x, y: opponent.y};
                else moveTarget = {x: bestP.x, y: bestP.y};
            }
        }

        if (!shouldMove) {
            let ang = Math.atan2(opponent.y - ai.y, opponent.x - ai.x);
            rotateTowards(ai, ang, 0.1); return;
        }

        let directVis = hasLineOfSight(ai.x, ai.y, moveTarget.x, moveTarget.y);
        if (!directVis) {
            if (ai.aiPathTimer++ % 20 === 0 || ai.aiCurrentPath.length === 0) { 
                ai.aiCurrentPath = getBFSPath(ai.x, ai.y, moveTarget.x, moveTarget.y); 
                ai.aiTargetCell = 0; 
            }
            if (ai.aiCurrentPath.length > 0) {
                let cell = ai.aiCurrentPath[ai.aiTargetCell];
                if (cell) {
                    let nextX = cell.x * cellSize + cellSize/2; 
                    let nextY = cell.y * cellSize + cellSize/2;
                    if (dist(ai.x, ai.y, nextX, nextY) < 30) { 
                        ai.aiTargetCell++; 
                        if (ai.aiTargetCell >= ai.aiCurrentPath.length) ai.aiCurrentPath = []; 
                    } 
                    else { moveTarget = {x: nextX, y: nextY}; }
                }
            }
        } else ai.aiCurrentPath = []; 

        let dx = moveTarget.x - ai.x; let dy = moveTarget.y - ai.y;
        let moveAngle = Math.atan2(dy, dx);
        rotateTowards(ai, moveAngle, 0.15); 
        
        let diffMove = moveAngle - ai.angle;
        while(diffMove < -Math.PI) diffMove += Math.PI*2; while(diffMove > Math.PI) diffMove -= Math.PI*2;
        
        if (Math.abs(diffMove) < 0.5) {
            let speed = (ai.activeShield ? 3.5 : diff.moveSpeed);
            ai.currentVx = Math.cos(ai.angle) * speed; ai.currentVy = Math.sin(ai.angle) * speed;
            if(!checkWallCollision(ai.x + ai.currentVx, ai.y, ai.hitbox)) { ai.x += ai.currentVx; }
            if(!checkWallCollision(ai.x, ai.y + ai.currentVy, ai.hitbox)) { ai.y += ai.currentVy; }
            ai.drawTracks();
        }
    }
}

function getDodgeVector(ai, bullets, walls) {
    let dodgeX = 0;
    let dodgeY = 0;
    let dangerCount = 0;
    const detectionRadius = 180; 
    const panicRadius = 60;

    for (let b of bullets) {
        if (b.dead || b.owner === ai) continue; 
        if (b.type === 'mine' && b.visible === false) continue; 

        let distToBullet = dist(ai.x, ai.y, b.x, b.y);

        if (distToBullet < detectionRadius) {
            let bVx = b.vx || 0;
            let bVy = b.vy || 0;
            let toAIX = ai.x - b.x;
            let toAIY = ai.y - b.y;
            let dot = bVx * toAIX + bVy * toAIY;

            if (distToBullet < panicRadius || dot > 0) {
                let weight = (detectionRadius - distToBullet) / detectionRadius;
                let len = Math.hypot(toAIX, toAIY);
                if (len > 0) {
                    dodgeX += (toAIX / len) * weight * 10;
                    dodgeY += (toAIY / len) * weight * 10;
                }
                if (b.type === 'mine' && distToBullet < 80) {
                    dodgeX += (toAIX / len) * 20;
                    dodgeY += (toAIY / len) * 20;
                }
                dangerCount++;
            }
        }
    }

    if (dangerCount > 0) {
        return { x: dodgeX, y: dodgeY, active: true };
    }
    return { x: 0, y: 0, active: false };
}

function findFiringSolution(ai, target, maxBounces) {
    let distToTarget = dist(ai.x, ai.y, target.x, target.y);
    let timeToImpact = distToTarget / 3.0; 
    let predX = target.x + (target.currentVx || 0) * timeToImpact;
    let predY = target.y + (target.currentVy || 0) * timeToImpact;

    if (hasLineOfSight(ai.x, ai.y, predX, predY)) {
        return Math.atan2(predY - ai.y, predX - ai.x);
    }

    if (maxBounces > 0) {
        const stepAngle = 4;
        let baseAngle = Math.atan2(target.y - ai.y, target.x - ai.x);
        let startDeg = (baseAngle * 180 / Math.PI) - 120;
        let endDeg = (baseAngle * 180 / Math.PI) + 120;

        for (let deg = startDeg; deg <= endDeg; deg += stepAngle) {
            let rad = deg * (Math.PI / 180);
            if (simulateRicochet(ai.x, ai.y, rad, target, maxBounces, ai)) {
                return rad;
            }
        }
    }
    return null;
}

function simulateRicochet(startX, startY, angle, target, maxBounces, shooter) {
    let x = startX;
    let y = startY;
    let speed = 4.0; 
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    
    let bounces = 0;
    const maxSteps = 400; 
    const hitRadiusSq = 400; 
    const safetyRadiusSq = 1225; 
    const wallCheckRad = 4;

    for (let i = 0; i < maxSteps; i++) {
        x += vx;
        y += vy;

        if (checkWallCollision(x, y, wallCheckRad)) {
            if (bounces >= maxBounces) return false; 
            x -= vx; y -= vy;
            let bounceInfo = calculateBounce(x, y, vx, vy, wallCheckRad);
            vx = bounceInfo.vx;
            vy = bounceInfo.vy;
            bounces++;
            if (i < 5) return false; 
            continue; 
        }

        let dx = x - target.x;
        let dy = y - target.y;
        if ((dx*dx + dy*dy) < hitRadiusSq) { 
            return true; 
        }

        if (bounces > 0 || i > 20) { 
             let ds = x - shooter.x;
             let dsy = y - shooter.y;
             if ((ds*ds + dsy*dsy) < safetyRadiusSq) {
                 return false; 
             }
        }
    }
    return false;
}

function rotateTowards(obj, targetAngle, speed) {
    let diff = targetAngle - obj.angle;
    while(diff < -Math.PI) diff += Math.PI*2; while(diff > Math.PI) diff -= Math.PI*2;
    obj.angle += Math.sign(diff) * Math.min(Math.abs(diff), speed);
}

// --- RAYCASTING LOGIC ---
function getIntersection(ray, segment) {
    let r_px = ray.a.x; let r_py = ray.a.y;
    let r_dx = ray.b.x - ray.a.x; let r_dy = ray.b.y - ray.a.y;
    let s_px = segment.a.x; let s_py = segment.a.y;
    let s_dx = segment.b.x - segment.a.x; let s_dy = segment.b.y - segment.a.y;

    let r_mag = Math.sqrt(r_dx*r_dx + r_dy*r_dy);
    let s_mag = Math.sqrt(s_dx*s_dx + s_dy*s_dy);
    if(r_dx/r_mag==s_dx/s_mag && r_dy/r_mag==s_dy/s_mag) return null;

    let T2 = (r_dx*(s_py-r_py) + r_dy*(r_px-s_px))/(s_dx*r_dy - s_dy*r_dx);
    let T1 = (s_px+s_dx*T2-r_px)/r_dx;
    if(isNaN(T1)) T1 = (s_py+s_dy*T2-r_py)/r_dy;

    if(T1<0) return null;
    if(T2<0 || T2>1) return null;

    return { x: r_px+r_dx*T1, y: r_py+r_dy*T1, param: T1 };
}

function castRays(sourceX, sourceY, startAngle, endAngle, radius) {
    let points = [];
    let segments = [];
    segments.push({a:{x:0,y:0}, b:{x:canvas.width,y:0}});
    segments.push({a:{x:canvas.width,y:0}, b:{x:canvas.width,y:canvas.height}});
    segments.push({a:{x:canvas.width,y:canvas.height}, b:{x:0,y:canvas.height}});
    segments.push({a:{x:0,y:canvas.height}, b:{x:0,y:0}});
    
    for(let w of walls) {
        if (Math.hypot(w.x - sourceX, w.y - sourceY) > radius + 100) continue;
        segments.push({a:{x:w.x,y:w.y}, b:{x:w.x+w.w,y:w.y}});
        segments.push({a:{x:w.x+w.w,y:w.y}, b:{x:w.x+w.w,y:w.y+w.h}});
        segments.push({a:{x:w.x+w.w,y:w.y+w.h}, b:{x:w.x,y:w.y+w.h}});
        segments.push({a:{x:w.x,y:w.y+w.h}, b:{x:w.x,y:w.y}});
    }

    for(let angle = startAngle; angle <= endAngle; angle += 0.08) {
        let dx = Math.cos(angle);
        let dy = Math.sin(angle);
        let closest = null;
        let minT = radius;
        let ray = {a:{x:sourceX, y:sourceY}, b:{x:sourceX+dx*radius, y:sourceY+dy*radius}};

        for(let seg of segments) {
            let intersect = getIntersection(ray, seg);
            if(intersect) {
                if(intersect.param < minT) {
                    minT = intersect.param;
                    closest = intersect;
                }
            }
        }
        if(closest) points.push(closest);
        else points.push({x: sourceX+dx*radius, y: sourceY+dy*radius});
    }
    return points;
}

// --- HỆ THỐNG ÁNH SÁNG (PHIÊN BẢN TRONG SUỐT NHƯ AURA) ---
function renderLighting() {
    shadowCtx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height);

    if (isNightMode) {
        shadowCtx.fillStyle = "rgba(0, 0, 0, 0.985)"; 
        shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);

        const CONE_WIDTH = Math.PI / 3; 
        const RANGE = 450;             
        const dustOffset = (Date.now() / 50) % 256; 

        const drawTankLight = (tank) => {
            if (tank.dead) return;

            let startA = tank.angle - CONE_WIDTH / 2;
            let endA = tank.angle + CONE_WIDTH / 2;

            let poly = castRays(tank.x, tank.y, startA, endA, RANGE);

            // --- BƯỚC 1: ĐỤC LỖ (Cắt bóng tối) ---
            shadowCtx.globalCompositeOperation = 'destination-out';
            
            // Cắt Beam
            shadowCtx.beginPath();
            shadowCtx.moveTo(tank.x, tank.y);
            for (let p of poly) shadowCtx.lineTo(p.x, p.y);
            shadowCtx.closePath();
            
            // Gradient Cắt mềm mại
            let cutGrd = shadowCtx.createRadialGradient(tank.x, tank.y, 0, tank.x, tank.y, RANGE);
            cutGrd.addColorStop(0, "rgba(0,0,0,1)");     
            cutGrd.addColorStop(0.7, "rgba(0,0,0,0.8)"); // Giảm độ cắt ở xa
            cutGrd.addColorStop(1, "rgba(0,0,0,0)");     
            shadowCtx.fillStyle = cutGrd;
            shadowCtx.fill();

            // Cắt Aura
            shadowCtx.beginPath();
            shadowCtx.arc(tank.x, tank.y, 50, 0, Math.PI * 2); 
            let haloCut = shadowCtx.createRadialGradient(tank.x, tank.y, 0, tank.x, tank.y, 50);
            haloCut.addColorStop(0, "rgba(0,0,0,1)"); 
            haloCut.addColorStop(1, "rgba(0,0,0,0)");
            shadowCtx.fillStyle = haloCut;
            shadowCtx.fill();

            // --- BƯỚC 2: TÔ MÀU (SIÊU TRONG SUỐT) ---
            shadowCtx.globalCompositeOperation = 'lighter'; 

            // A. Vẽ Bụi (Texture siêu mờ)
            shadowCtx.save(); 
            shadowCtx.beginPath();
            shadowCtx.moveTo(tank.x, tank.y);
            for (let p of poly) shadowCtx.lineTo(p.x, p.y);
            shadowCtx.closePath();
            shadowCtx.clip(); 

            let pattern = shadowCtx.createPattern(noiseCanvas, 'repeat');
            let moveX = tank.x + Math.cos(tank.angle) * dustOffset; 
            let moveY = tank.y + Math.sin(tank.angle) * dustOffset;
            
            shadowCtx.translate(moveX, moveY); 
            shadowCtx.fillStyle = pattern;
            shadowCtx.fillRect(-moveX, -moveY, canvas.width, canvas.height); 
            shadowCtx.restore(); 

            // B. Vẽ Ánh Sáng Trắng (MỨC 0.02 - Trong suốt như kính)
            shadowCtx.beginPath();
            shadowCtx.moveTo(tank.x, tank.y);
            for (let p of poly) shadowCtx.lineTo(p.x, p.y);
            shadowCtx.closePath();

            let colorGrd = shadowCtx.createRadialGradient(tank.x, tank.y, 0, tank.x, tank.y, RANGE);
            
            // [CHỈNH SỬA QUAN TRỌNG NHẤT]
            // Alpha 0.02: Cực thấp để không bị đục
            // Stop 0.7: Màu tắt sớm hơn phạm vi cắt, giúp đuôi đèn hoàn toàn trong veo
            colorGrd.addColorStop(0, "rgba(255, 255, 255, 0.02)"); 
            colorGrd.addColorStop(0.7, "rgba(0,0,0,0)");
            
            shadowCtx.fillStyle = colorGrd;
            shadowCtx.fill();

            // C. Aura mờ (Mức 0.04 - Hơi sáng hơn đèn một chút để nổi bật xe)
            shadowCtx.beginPath();
            shadowCtx.arc(tank.x, tank.y, 50, 0, Math.PI * 2);
            let haloColor = shadowCtx.createRadialGradient(tank.x, tank.y, 0, tank.x, tank.y, 50);
            haloColor.addColorStop(0, "rgba(255, 255, 255, 0.04)"); 
            haloColor.addColorStop(1, "rgba(0,0,0,0)");
            shadowCtx.fillStyle = haloColor;
            shadowCtx.fill();
        };

        drawTankLight(p1);
        drawTankLight(p2);

        // --- CÁC HIỆU ỨNG KHÁC ---
        shadowCtx.globalCompositeOperation = 'destination-out';
        const drawSimpleHalo = (x, y, radius, intensity) => {
            shadowCtx.beginPath();
            shadowCtx.arc(x, y, radius, 0, Math.PI * 2);
            let grd = shadowCtx.createRadialGradient(x, y, 0, x, y, radius);
            grd.addColorStop(0, `rgba(0,0,0,${intensity})`);
            grd.addColorStop(1, "rgba(0,0,0,0)");
            shadowCtx.fillStyle = grd;
            shadowCtx.fill();
        };

        if (p1.flashTimer > 0) { drawSimpleHalo(p1.x, p1.y, 400, p1.flashTimer/10); p1.flashTimer--; }
        if (p2.flashTimer > 0) { drawSimpleHalo(p2.x, p2.y, 400, p2.flashTimer/10); p2.flashTimer--; }

        for (let b of bullets) {
            let r = (b.type === 'missile' || b.type === 'flame') ? 100 : 50; 
            if (b.type === 'mine' && !b.visible) continue;
            drawSimpleHalo(b.x, b.y, r, 0.8);
        }
        for (let p of particles) {
            if (p.type === 'fire' || p.type === 'flash') drawSimpleHalo(p.x, p.y, p.size * 8, p.life);
        }
        for (let l of activeLasers) {
            if(l.active) {
                shadowCtx.beginPath(); 
                shadowCtx.lineCap = "round";
                shadowCtx.moveTo(l.start.x, l.start.y); 
                shadowCtx.lineTo(l.end.x, l.end.y);
                shadowCtx.lineWidth = 35; 
                shadowCtx.strokeStyle = "rgba(0,0,0,0.6)"; 
                shadowCtx.stroke();
            }
        }
        
        // Render halo cho thùng thuốc nổ (để dễ thấy trong đêm)
        for (let bar of barrels) {
            if (bar.active) drawSimpleHalo(bar.x, bar.y, 80, 0.7);
        }

        shadowCtx.globalCompositeOperation = 'source-over';
    }
}

// --- MAZE & GENERATION ---
function generateMaze() {
    walls=[]; wallPath=new Path2D(); powerups=[]; activeLasers=[]; tracks=[];
    let cols=Math.floor(canvas.width/cellSize), rows=Math.floor(canvas.height/cellSize);
    let grid=[]; for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) grid.push({i,j,v:false,w:[1,1,1,1]});
    let stack=[], curr=grid[0]; curr.v=true;
    const idx=(i,j)=>(i<0||j<0||i>=cols||j>=rows)?-1:i+j*cols;
    let safeLoop = 0;
    while(safeLoop < 5000){ 
        safeLoop++; let nexts=[], t=grid[idx(curr.i,curr.j-1)], r=grid[idx(curr.i+1,curr.j)], b=grid[idx(curr.i,curr.j+1)], l=grid[idx(curr.i-1,curr.j)];
        if(t&&!t.v)nexts.push({c:t,d:0}); if(r&&!r.v)nexts.push({c:r,d:1}); if(b&&!b.v)nexts.push({c:b,d:2}); if(l&&!l.v)nexts.push({c:l,d:3});
        if(nexts.length){ let n=nexts[Math.floor(Math.random()*nexts.length)]; curr.w[n.d]=0; n.c.w[(n.d+2)%4]=0; stack.push(curr); curr=n.c; curr.v=true; }
        else if(stack.length) curr=stack.pop(); else break;
    }
    for(let j=1; j<rows-1; j++) {
        for(let i=1; i<cols-1; i++) {
            let c = grid[idx(i,j)];
            if (Math.random() < 0.45) {
                let wallToRemove = Math.floor(Math.random() * 4);
                if (c.w[wallToRemove] === 1) {
                    c.w[wallToRemove] = 0;
                    if(wallToRemove===0) grid[idx(i,j-1)].w[2]=0; if(wallToRemove===1) grid[idx(i+1,j)].w[3]=0;
                    if(wallToRemove===2) grid[idx(i,j+1)].w[0]=0; if(wallToRemove===3) grid[idx(i-1,j)].w[1]=0;
                }
            }
        }
    }
    for(let c of grid){
        let x=c.i*cellSize, y=c.j*cellSize;
        const addW=(ax,ay,w,h)=>{ walls.push({x:ax,y:ay,w,h}); wallPath.rect(ax,ay,w,h); };
        let ht=wallThickness/2;
        if(c.w[0]) addW(x-ht, y-ht, cellSize+wallThickness, wallThickness); if(c.w[3]) addW(x-ht, y-ht, wallThickness, cellSize+wallThickness);
        if(c.i===cols-1 && c.w[1]) addW(x+cellSize-ht, y-ht, wallThickness, cellSize+wallThickness); if(c.j===rows-1 && c.w[2]) addW(x-ht, y+cellSize-ht, cellSize+wallThickness, wallThickness);
    }
    let arr=Array.from({length:grid.length},(_,i)=>i); for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    p1.startX=grid[arr[0]].i*cellSize+cellSize/2; p1.startY=grid[arr[0]].j*cellSize+cellSize/2;
    p2.startX=grid[arr[1]].i*cellSize+cellSize/2; p2.startY=grid[arr[1]].j*cellSize+cellSize/2;
    if(gameMode === 'pve') { p2.isAI = true; p2.name = "BOT"; } else { p2.isAI = false; p2.name = "P2"; }
    p1.reset(); p2.reset();
    timerSpawnItems = gameSettings.spawnTime * 60; mazeGrid = grid; 

    // --- LOGIC MỚI: SINH THÙNG TNT ÉP SÁT TƯỜNG (CHỈ TRONG DEATHMATCH) ---
    if (isDeathmatch) {
        let barrelCount = 5 + Math.floor(Math.random() * 4); // Số lượng 5-8 thùng (Giảm 2/3 so với cũ)
        let placedCount = 0;
        let attempts = 0;

        // Vòng lặp thử tìm vị trí
        while (placedCount < barrelCount && attempts < 1000) {
            attempts++;
            
            // 1. CHỌN MỘT BỨC TƯỜNG BẤT KỲ ĐỂ "DỰA VÀO"
            if (walls.length === 0) break;
            let w = walls[Math.floor(Math.random() * walls.length)];
            
            // 2. CHỌN 1 TRONG 4 HƯỚNG CỦA TƯỜNG
            let side = Math.floor(Math.random() * 4); 
            let bx, by;
            const r = 16;  // Bán kính thùng (khớp với class Barrel)
            const gap = 2; // Khoảng hở nhỏ
            
            if (side === 0) { // TRÊN
                bx = w.x + Math.random() * w.w; 
                by = w.y - r - gap;             
            } else if (side === 1) { // DƯỚI
                bx = w.x + Math.random() * w.w;
                by = w.y + w.h + r + gap;
            } else if (side === 2) { // TRÁI
                bx = w.x - r - gap;
                by = w.y + Math.random() * w.h;
            } else { // PHẢI
                bx = w.x + w.w + r + gap;
                by = w.y + Math.random() * w.h;
            }

            // 3. KIỂM TRA HỢP LỆ
            if (bx < 40 || bx > canvas.width - 40 || by < 40 || by > canvas.height - 40) continue;
            // Check tường khác (Tránh kẹt vào góc)
            if (checkWallCollision(bx, by, r - 5)) continue;
            // Check xa người chơi
            if (dist(bx, by, p1.x, p1.y) < 150) continue;
            if (dist(bx, by, p2.x, p2.y) < 150) continue;

            // Check chồng chéo thùng khác
            let overlap = false;
            for (let existing of barrels) { 
                if (dist(bx, by, existing.x, existing.y) < r * 2.2) overlap = true; 
            }
            if (overlap) continue;

            barrels.push(new Barrel(bx, by));
            placedCount++;
        }
    }
}

function spawnPowerUp() {
    if (powerups.length >= gameSettings.maxItems) return;
    let px, py, valid = false; let attempts = 0;
    while(!valid && attempts < 100) { 
        attempts++; px = Math.random() * (canvas.width - 40) + 20; py = Math.random() * (canvas.height - 40) + 20;
        valid = true; for(let w of walls) { if(px > w.x - 20 && px < w.x + w.w + 20 && py > w.y - 20 && py < w.y + w.h + 20) { valid = false; break; } }
    }
    if(valid) powerups.push(new PowerUp(px, py));
}

// Effects Helpers
function explodeFrag(x, y, color) { for(let i=0; i<13; i++) { let angle = Math.random() * Math.PI * 2; bullets.push(new Bullet(x, y, angle, color, 'fragment', null)); } createExplosion(x, y, color); createSmoke(x, y); }
function createHitEffect(x, y, color = '#fff') { 
    for(let i = 0; i < 6; i++) {
        particles.push(new Particle(x, y, 'spark', color));
    }
    for(let i = 0; i < 3; i++) {
        particles.push(new Particle(x, y, 'debris', '#888'));
    }
}
function createSparks(x,y,c,n) { for(let i=0;i<n;i++) particles.push(new Particle(x,y,'spark',c)); }

function createExplosion(x, y, color, big = false) { 
    shakeAmount = big ? 25 : 15; // Rung màn hình
    
    // 1. Ánh sáng lóe lên
    particles.push(new Particle(x, y, 'flash', '#fff'));
    
    // 2. Sóng xung kích (Shockwave)
    particles.push(new Particle(x, y, 'shockwave', color === '#fff' ? '#aaa' : color));
    if (big) particles.push(new Particle(x, y, 'shockwave', '#fff'));

    // 3. Lửa và Khói
    let fireCount = big ? 18 : 8;
    let smokeCount = big ? 10 : 5;
    
    for(let i = 0; i < fireCount; i++) {
        particles.push(new Particle(x, y, 'fire', '#ff5722'));
    }
    for(let i = 0; i < smokeCount; i++) {
        particles.push(new Particle(x, y, 'smoke', '#555')); // Khói xám
    }

    // 4. Mảnh vỡ (Debris)
    for(let i = 0; i < 6; i++) {
        particles.push(new Particle(x, y, 'debris', color));
    }
}

function createSmoke(x, y) { for(let i=0;i<2;i++) particles.push(new Particle(x,y,'smoke','#888')); }

function resetRound() { 
    bullets=[]; particles=[]; powerups=[]; activeLasers=[]; 
    barrels = []; // Xóa thùng cũ
    msgBox.style.display="none"; roundEnding=false; 
    if(roundEndTimer) clearTimeout(roundEndTimer); 
    p1.activeShield = false; p2.activeShield = false; 
    tracks = []; 
    bgCtx.clearRect(0, 0, canvas.width, canvas.height); 
    generateMaze(); 
}

function loop() {
    animationId = requestAnimationFrame(loop); if(gamePaused) return;
    let dx=0, dy=0; if(shakeAmount>0){ dx=(Math.random()-0.5)*shakeAmount; dy=(Math.random()-0.5)*shakeAmount; shakeAmount*=0.9; if(shakeAmount<0.5)shakeAmount=0; }
    
    // 1. XÓA MÀN HÌNH CHÍNH & VẼ TƯỜNG (LỚP ĐÁY)
    ctx.save(); ctx.translate(dx,dy); ctx.clearRect(-dx,-dy,canvas.width,canvas.height); 
    ctx.fillStyle="#444"; ctx.fill(wallPath);
    
    // 2. VẼ VẾT BÁNH XE (Lớp nền phụ)
    bgCtx.clearRect(0, 0, canvas.width, canvas.height); 
    for(let i=tracks.length-1; i>=0; i--) { let t = tracks[i]; t.update(); t.draw(bgCtx); if (t.life <= 0) tracks.splice(i, 1); }

    // 3. TÍNH TOÁN & VẼ BÓNG TỐI (NẾU CÓ)
    if (isNightMode) {
        renderLighting(); 
        // Vẽ lớp bóng tối ĐÈ LÊN tường (nhưng sẽ có lỗ thủng để lộ tường)
        ctx.drawImage(shadowCanvas, 0, 0);
    }

    // 4. CẬP NHẬT LOGIC GAME
    timerSpawnItems--; if(timerSpawnItems <= 0) { spawnPowerUp(); timerSpawnItems = gameSettings.spawnTime * 60; }
    
    // 5. VẼ CÁC ĐỐI TƯỢNG "SÁNG" (ĐÈ LÊN LỚP BÓNG TỐI)
    // Để người chơi luôn nhìn thấy vật phẩm, đạn và xe tăng
    for(let p of powerups) p.draw();
    
    // VẼ THÙNG THUỐC NỔ
    for(let i = barrels.length - 1; i >= 0; i--) {
        let bar = barrels[i];
        if (!bar.active) { barrels.splice(i, 1); continue; }
        bar.draw();
    }

    for(let b of bullets) { if(b.type === 'mine') b.draw(); }
    for(let i=activeLasers.length-1; i>=0; i--) { let l = activeLasers[i]; l.update(); l.draw(); if(!l.active) activeLasers.splice(i, 1); }
    
    p1.update(walls, powerups); p1.draw(); updateAmmoUI(p1);
    if (p2.isAI) updateAI(p2, p1); p2.update(walls, powerups); p2.draw(); updateAmmoUI(p2);
    
    // Update đạn & va chạm
    for(let i=bullets.length-1; i>=0; i--){
        let b=bullets[i]; b.update(walls); if(b.type !== 'mine') b.draw(); 
        
        // KIỂM TRA ĐẠN BẮN TRÚNG THÙNG (MỚI: SỬ DỤNG HITBOX VUÔNG)
        for (let bar of barrels) {
            if (bar.active && !b.dead) {
                // Tính toán hitbox hình vuông
                let size = bar.radius * 2;
                let left = bar.x - bar.radius;
                let top = bar.y - bar.radius;
                
                // Dùng hàm circleRectCollide
                if (circleRectCollide(b.x, b.y, b.radius, left, top, size, size)) {
                    bar.explode();
                    b.dead = true;
                    break;
                }
            }
        }

        if(!b.dead){ 
            if(!p1.dead && circleRectCollide(b.x,b.y,b.radius,p1.x-9,p1.y-9,18,18) && b.owner!==p1){ p1.takeDamage(b.owner, b); }
            else if(!p2.dead && circleRectCollide(b.x,b.y,b.radius,p2.x-9,p2.y-9,18,18) && b.owner!==p2){ p2.takeDamage(b.owner, b); }
        }
        if(!b.dead && b.type==='fragment') {
                if(!p1.dead && circleRectCollide(b.x,b.y,b.radius,p1.x-9,p1.y-9,18,18)) { p1.takeDamage(null, b); }
                if(!p2.dead && circleRectCollide(b.x,b.y,b.radius,p2.x-9,p2.y-9,18,18)) { p2.takeDamage(null, b); }
        }
        if(!b.dead && b.life<460) {
                if(!p1.dead && circleRectCollide(b.x,b.y,b.radius,p1.x-9,p1.y-9,18,18)) { p1.takeDamage(null, b); }
                if(!p2.dead && circleRectCollide(b.x,b.y,b.radius,p2.x-9,p2.y-9,18,18)) { p2.takeDamage(null, b); }
        }
        if(b.dead) bullets.splice(i,1);
    }

    for(let i=particles.length-1;i>=0;i--){ let p=particles[i]; p.update(); p.draw(); if(p.life<=0) particles.splice(i,1); }
    
    ctx.restore();
}

window.startGame = function() { 
    hideAllMenus(); 
    document.getElementById('bottomBar').style.display = 'flex'; 
    if(animationId) cancelAnimationFrame(animationId); gameRunning = true; gamePaused = false; 
    scores = {p1:0, p2:0}; document.getElementById('s1').innerText="0"; document.getElementById('s2').innerText="0"; 
    if(isMobile) document.getElementById('mobileControls').style.display = 'block';
    resetRound(); loop(); 
}

// INITIALIZATION
p1 = new Tank(0,0,"#4CAF50","P1",null,'ammo-p1'); 
p2 = new Tank(0,0,"#D32F2F","P2",null,'ammo-p2');

function destroyWall(index) {
    if (index > -1 && index < walls.length) {
        let w = walls[index];
        if (w.x < 5 || w.y < 5 || w.x + w.w > canvas.width - 5 || w.y + w.h > canvas.height - 5) {
            createSparks(w.x + w.w/2, w.y + w.h/2, "#aaa", 5); 
            return; 
        }
        let cx = w.x + w.w/2;
        let cy = w.y + w.h/2;
        for(let k=0; k<8; k++) {
            particles.push(new Particle(cx + (Math.random()-0.5)*w.w, cy + (Math.random()-0.5)*w.h, 'debris', '#555'));
        }
        createSmoke(cx, cy);
        walls.splice(index, 1);
        wallPath = new Path2D();
        for(let w of walls) {
            wallPath.rect(w.x, w.y, w.w, w.h);
        }
    }
}
window.destroyWall = destroyWall;