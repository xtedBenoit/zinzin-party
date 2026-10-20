import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import { RoomManager, type Room } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3000);
/** URL publique forcée (ex. https://zinzin.mondomaine.fr) ; sinon déduite de la requête ou du LAN. */
const PUBLIC_URL = process.env.PUBLIC_URL ?? null;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? true;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// En-têtes de sécurité HTTP pour la production (SAMEORIGIN permet le mode /demo en iframe locale).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: ALLOWED_ORIGIN },
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 16 * 1024, // 16 Ko max par paquet WebSocket
});
const rooms = new RoomManager(io);

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    .sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

app.get('/api/info', (req, res) => {
  let publicUrl = PUBLIC_URL;
  const host = req.get('host') ?? '';
  if (!publicUrl && host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    publicUrl = `${req.protocol}://${host}`;
  }
  res.json({ publicUrl, lanIps: lanAddresses() });
});

const qrCache = new Map<string, string>();
app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text ?? '').trim().slice(0, 300);
    if (!text) return void res.status(400).end();
    let svg = qrCache.get(text);
    if (!svg) {
      svg = await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        color: { dark: '#1b1035', light: '#ffffff' },
      });
      if (qrCache.size >= 200) {
        const oldest = qrCache.keys().next().value;
        if (oldest) qrCache.delete(oldest);
      }
      qrCache.set(text, svg);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(500).end();
  }
});

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json({
    name: 'Zinzin Party 🎉',
    short_name: 'Zinzin Party',
    description: 'Party game multijoueur : la TV héberge la partie, les téléphones sont les manettes !',
    start_url: '/',
    display: 'standalone',
    background_color: '#1b1035',
    theme_color: '#1b1035',
    icons: [
      {
        src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%231b1035'/><text x='50' y='68' font-size='60' text-anchor='middle'>🎉</text></svg>",
        sizes: '192x192',
        type: 'image/svg+xml',
      },
    ],
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    players: rooms.totalPlayers,
    uptimeSec: Math.round(process.uptime()),
  });
});

// En production, le serveur sert aussi le front compilé par Vite.
const clientDir = path.resolve(process.cwd(), 'dist/client');
if (existsSync(clientDir)) {
  app.use(
    express.static(clientDir, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/^\/(?!api|socket\.io|manifest\.webmanifest).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// Limitation anti-abus par IP pour la création de salons (max 25 salons / 5 min par IP).
const ipRoomCreations = new Map<string, { count: number; resetAt: number }>();
function canCreateRoom(ip: string): boolean {
  const now = Date.now();
  const entry = ipRoomCreations.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRoomCreations.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
    return true;
  }
  if (entry.count >= 25) return false;
  entry.count++;
  return true;
}

io.on('connection', (socket) => {
  let room: Room | undefined;
  const clientIp = String(socket.handshake.headers['x-forwarded-for'] ?? socket.handshake.address ?? 'unknown')
    .split(',')[0]!
    .trim();

  // Limitation de débit par socket (max 40 événements / 4 secondes).
  let eventCount = 0;
  let windowReset = Date.now() + 4_000;
  socket.use((_packet, next) => {
    const now = Date.now();
    if (now > windowReset) {
      eventCount = 0;
      windowReset = now + 4_000;
    }
    if (++eventCount > 40) return next(new Error('Rate limit exceeded'));
    next();
  });

  const bindRoom = (r: Room) => {
    if (room && room !== r) socket.leave(room.code);
    room = r;
    socket.join(r.code);
  };

  socket.on('host:create', (cb) => {
    if (typeof cb !== 'function') return;
    if (!canCreateRoom(clientIp)) {
      return cb({ ok: false, error: 'Trop de parties créées récemment, patiente une minute.' });
    }
    const r = rooms.create();
    if (!r) return cb({ ok: false, error: 'Le serveur est complet pour le moment.' });
    r.hostSocketId = socket.id;
    bindRoom(r);
    cb({ ok: true, code: r.code, hostToken: r.hostToken });
    r.sync();
  });

  socket.on('host:resume', (payload, cb) => {
    if (typeof cb !== 'function' || !payload || typeof payload !== 'object') return;
    const { code, hostToken } = payload;
    const r = rooms.get(code);
    if (!r || r.hostToken !== hostToken) return cb({ ok: false, error: 'Partie introuvable.' });
    r.hostSocketId = socket.id;
    r.touch();
    bindRoom(r);
    cb({ ok: true });
    r.sync();
  });

  socket.on('player:join', (payload, cb) => {
    if (typeof cb !== 'function' || !payload || typeof payload !== 'object') return;
    const { code, name, token } = payload;
    const r = rooms.get(code);
    if (!r) return cb({ ok: false, error: 'Aucune partie avec ce code 🤔' });
    const res = r.join(String(name ?? ''), typeof token === 'string' ? token : undefined, socket.id);
    if ('error' in res) return cb({ ok: false, error: res.error });
    bindRoom(r);
    cb({ ok: true, playerId: res.player.id, token: res.player.token });
    r.sync();
  });

  socket.on('room:control', (action) => {
    if (!room || !action || typeof action !== 'object') return;
    const isHost = room.hostSocketId === socket.id;
    const isVip = room.playerBySocket(socket.id)?.id === room.vipId;
    if (!isHost && !isVip) return;
    // Seul l'écran hôte peut exclure un joueur.
    if (action.type === 'kick' && !isHost) return;
    room.control(action);
  });

  socket.on('game:action', (action) => {
    if (!action || typeof action !== 'object') return;
    const player = room?.playerBySocket(socket.id);
    if (room && player) room.gameAction(player.id, action);
  });

  socket.on('disconnect', () => {
    room?.disconnect(socket.id);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log(`\n🎉 Zinzin Party sur http://localhost:${PORT}`);
  if (ips[0]) console.log(`   Réseau local : http://${ips[0]}:${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`\nArrêt gracieux (${signal})…`);
  rooms.closeAll('Le serveur redémarre, à tout de suite !');
  void io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
