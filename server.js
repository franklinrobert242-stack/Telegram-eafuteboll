/**
 * PROTÓTIPO 3 — Servidor com SALAS PRIVADAS
 * -----------------------------------------------------------------------
 * Única mudança estrutural real em relação ao Protótipo 2: em vez de
 * UMA partida global (`match`), agora existe um Map de salas
 * (`rooms.get(codigo)`), cada uma com seu próprio estado (players, ball,
 * score...). O código da sala vem do bot do Telegram (bot.js), que gera
 * um convite e o Mini App abre já apontando pra sala certa via
 * "?room=CODIGO" na URL.
 *
 * Tudo o que já era autoritativo no Protótipo 2 (física, gol, chute)
 * continua igual — só passou a rodar "por sala" em vez de globalmente.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const FIELD_W = 800;
const FIELD_H = 500;
const GOAL_TOP = 190;
const GOAL_BOTTOM = 310;
const PLAYER_R = 12;
const BALL_R = 7;
const PLAYER_SPEED = 260;
const PLAYER_DRAG = 0.85;
const BALL_DRAG = 0.985;
const BALL_MAX_VEL = 500;
const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const ROOM_TTL_MS = 10 * 60 * 1000; // sala vazia é apagada após 10 min

// ---------------------------------------------------------------------
// Salas: code -> { players, ball, score, goalPause, order, lastActivity }
// ---------------------------------------------------------------------
const rooms = new Map();

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: {},
      ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
      score: { blue: 0, red: 0 },
      goalPause: false,
      order: [],
      lastActivity: Date.now()
    });
    console.log(`Sala criada: ${code}`);
  }
  return rooms.get(code);
}

function resetPositions(m) {
  m.ball.x = FIELD_W / 2; m.ball.y = FIELD_H / 2;
  m.ball.vx = 0; m.ball.vy = 0;
  for (const id of m.order) {
    const p = m.players[id];
    if (!p) continue;
    if (p.team === 'blue') { p.x = 150; p.y = FIELD_H / 2; }
    else { p.x = FIELD_W - 150; p.y = FIELD_H / 2; }
    p.vx = 0; p.vy = 0;
  }
}

function addPlayer(m, id) {
  const team = m.order.length === 0 ? 'blue' : 'red';
  m.players[id] = {
    team,
    x: team === 'blue' ? 150 : FIELD_W - 150,
    y: FIELD_H / 2,
    vx: 0, vy: 0,
    facing: { x: team === 'blue' ? 1 : -1, y: 0 },
    charge: 0,
    input: { up: false, down: false, left: false, right: false, kick: false },
    prevKick: false
  };
  m.order.push(id);
  return team;
}

function removePlayer(m, id) {
  delete m.players[id];
  m.order = m.order.filter((x) => x !== id);
}

// ---------------------------------------------------------------------
// Simulação de UMA sala (idêntica à lógica do Protótipo 2, parametrizada)
// ---------------------------------------------------------------------
function stepRoom(m) {
  if (m.goalPause || m.order.length === 0) return;
  const dt = TICK_MS / 1000;

  for (const id of m.order) {
    const p = m.players[id];
    if (!p) continue;
    const { input } = p;

    let dx = 0, dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      p.vx = (dx / len) * PLAYER_SPEED;
      p.vy = (dy / len) * PLAYER_SPEED;
      p.facing = { x: dx / len, y: dy / len };
    } else {
      p.vx *= PLAYER_DRAG;
      p.vy *= PLAYER_DRAG;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(10 + PLAYER_R, Math.min(FIELD_W - 10 - PLAYER_R, p.x));
    p.y = Math.max(10 + PLAYER_R, Math.min(FIELD_H - 10 - PLAYER_R, p.y));

    const distToBall = Math.hypot(m.ball.x - p.x, m.ball.y - p.y);
    const nearBall = distToBall < PLAYER_R + BALL_R + 22;

    if (input.kick && nearBall) {
      p.charge = Math.min(p.charge + 24, 100);
    } else if (!input.kick) {
      p.charge = Math.max(p.charge - 16, 0);
    }

    if (p.prevKick && !input.kick && nearBall) {
      const power = 250 + p.charge * 4;
      m.ball.vx = p.facing.x * power;
      m.ball.vy = p.facing.y * power;
      p.charge = 0;
    }
    p.prevKick = input.kick;
  }

  const ids = m.order;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = m.players[ids[i]], b = m.players[ids[j]];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const minDist = PLAYER_R * 2;
      if (dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
      }
    }
  }

  for (const id of ids) {
    const p = m.players[id];
    if (!p) continue;
    const dx = m.ball.x - p.x, dy = m.ball.y - p.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minDist = PLAYER_R + BALL_R;
    if (dist < minDist) {
      const overlap = minDist - dist;
      const nx = dx / dist, ny = dy / dist;
      m.ball.x += nx * overlap;
      m.ball.y += ny * overlap;
      m.ball.vx += p.vx * 0.18;
      m.ball.vy += p.vy * 0.18;
    }
  }

  m.ball.x += m.ball.vx * dt;
  m.ball.y += m.ball.vy * dt;
  m.ball.vx *= BALL_DRAG;
  m.ball.vy *= BALL_DRAG;

  const speed = Math.hypot(m.ball.vx, m.ball.vy);
  if (speed > BALL_MAX_VEL) {
    m.ball.vx = (m.ball.vx / speed) * BALL_MAX_VEL;
    m.ball.vy = (m.ball.vy / speed) * BALL_MAX_VEL;
  }

  const insideGoalY = m.ball.y > GOAL_TOP && m.ball.y < GOAL_BOTTOM;
  if (m.ball.y < 10 + BALL_R) { m.ball.y = 10 + BALL_R; m.ball.vy *= -0.6; }
  if (m.ball.y > FIELD_H - 10 - BALL_R) { m.ball.y = FIELD_H - 10 - BALL_R; m.ball.vy *= -0.6; }
  if (!insideGoalY) {
    if (m.ball.x < 10 + BALL_R) { m.ball.x = 10 + BALL_R; m.ball.vx *= -0.6; }
    if (m.ball.x > FIELD_W - 10 - BALL_R) { m.ball.x = FIELD_W - 10 - BALL_R; m.ball.vx *= -0.6; }
  }

  if (insideGoalY && m.ball.x <= 2) {
    m.score.red++;
    onGoal(m);
  } else if (insideGoalY && m.ball.x >= FIELD_W - 2) {
    m.score.blue++;
    onGoal(m);
  }
}

function onGoal(m) {
  m.goalPause = true;
  broadcastRoom(m);
  setTimeout(() => {
    resetPositions(m);
    m.goalPause = false;
  }, 1200);
}

function broadcastRoom(m) {
  io.to(m.code).emit('state', {
    players: m.order.map((id) => {
      const p = m.players[id];
      return { id, team: p.team, x: p.x, y: p.y, charge: p.charge };
    }),
    ball: { x: m.ball.x, y: m.ball.y },
    score: m.score,
    goalPause: m.goalPause,
    waiting: m.order.length < 2
  });
}

// ---------------------------------------------------------------------
// Conexões — o código da sala chega via query string do socket:
// io("wss://...", { query: { room: "AB12CD" } })
// ---------------------------------------------------------------------
io.on('connection', (socket) => {
  const rawCode = (socket.handshake.query.room || 'lobby').toString();
  const code = rawCode.trim().toUpperCase().slice(0, 12) || 'LOBBY';

  const m = getOrCreateRoom(code);
  m.lastActivity = Date.now();

  if (m.order.length >= 2) {
    socket.emit('full');
    socket.disconnect(true);
    return;
  }

  socket.join(code);
  socket.data.room = code;
  const team = addPlayer(m, socket.id);
  socket.emit('assigned', { team, room: code });
  console.log(`Jogador ${socket.id} entrou na sala ${code} como ${team}`);

  socket.on('input', (input) => {
    const room = rooms.get(socket.data.room);
    const p = room && room.players[socket.id];
    if (!p) return;
    room.lastActivity = Date.now();
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      kick: !!input.kick
    };
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    removePlayer(room, socket.id);
    resetPositions(room);
    console.log(`Jogador ${socket.id} saiu da sala ${socket.data.room}`);
  });
});

// simula e transmite todas as salas ativas
setInterval(() => {
  for (const m of rooms.values()) stepRoom(m);
}, TICK_MS);

setInterval(() => {
  for (const m of rooms.values()) broadcastRoom(m);
}, TICK_MS);

// limpeza de salas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [code, m] of rooms.entries()) {
    if (m.order.length === 0 && now - m.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
      console.log(`Sala expirada removida: ${code}`);
    }
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor do Protótipo 3 (salas) rodando em http://localhost:${PORT}`);
});
