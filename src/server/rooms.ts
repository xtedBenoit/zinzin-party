import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  LIMITS,
  type CategoryId,
  type ClientToServerEvents,
  type ControlAction,
  type GameAction,
  type GameId,
  type PlayerPublic,
  type RoomPhase,
  type ServerToClientEvents,
} from '../shared/protocol.js';
import { buildCategoryList } from './games/content/categories.js';
import { MYTHO_PROMPTS } from './games/content/mytho-prompts.js';
import { QUIZ_QUESTIONS } from './games/content/quiz-questions.js';
import { GAME_LIST, GAMES } from './games/registry.js';
import type { GameContext, MiniGame } from './games/types.js';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const CATEGORIES = buildCategoryList(QUIZ_QUESTIONS, MYTHO_PROMPTS);
const VALID_CATEGORIES = new Set<CategoryId>(CATEGORIES.map((c) => c.id));

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O, trop proches de 1 et 0
const AVATARS = ['🦊', '🐸', '🐼', '🦄', '🐙', '🐵', '🦁', '🐯', '🐨', '🐷', '🐔', '🦖', '👽', '🤖', '🐳', '🦉'];
const COLORS = ['#ff4d6d', '#ffb703', '#06d6a0', '#4cc9f0', '#b388ff', '#ff8fab', '#90be6d', '#f9844a', '#43aa8b', '#4361ee', '#f72585', '#e9c46a'];
const BOT_NAMES = ['Bot Turbo', 'Bot Pépito', 'Bot Zinzin', 'Bot Astro', 'Bot Disco', 'Bot Ramen', 'Bot Pixel', 'Bot Mochi'];
const BOT_LIES = [
  'une calebasse dorée',
  'du piment rouge',
  'trois noix de kola',
  'un tambour royal',
  'des pigeons voyageurs',
  'un boubou brodé',
  'du beurre de karité',
  'un perroquet gris',
  'une pirogue sculptée',
  'la pleine lune',
  'sept cauris blancs',
  'un chapeau de paille',
];

interface Player extends PlayerPublic {
  token: string;
  socketId: string | null;
  joinedAt: number;
}

export class Room {
  readonly hostToken = randomUUID();
  hostSocketId: string | null = null;
  readonly players = new Map<string, Player>();
  phase: RoomPhase = 'lobby';
  selectedCategory: CategoryId = 'afrique-pack';
  game: MiniGame | null = null;
  lastGameId: GameId | null = null;
  lastActivity = Date.now();
  private readonly usedItems = new Set<string>();
  private botTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    readonly code: string,
    private readonly io: IO,
  ) {}

  /** Le VIP (👑) est le plus ancien joueur humain connecté : il peut piloter depuis son téléphone. */
  get vipId(): string | null {
    let vip: Player | null = null;
    for (const p of this.players.values()) {
      if (p.connected && !p.isBot && (!vip || p.joinedAt < vip.joinedAt)) vip = p;
    }
    return vip?.id ?? null;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  /* ------------------------------------------------------------ joueurs */

  join(name: string, token: string | undefined, socketId: string): { player: Player } | { error: string } {
    this.touch();
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        existing.connected = true;
        this.game?.onPlayersChanged();
        return { player: existing };
      }
    }

    const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
    if (!cleanName) return { error: 'Choisis un pseudo !' };
    if (this.players.size >= LIMITS.maxPlayers) return { error: 'La partie est pleine 😬' };
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    if (taken) return { error: 'Ce pseudo est déjà pris dans cette partie.' };

    const used = new Set([...this.players.values()].map((p) => p.avatar));
    const avatar = AVATARS.find((a) => !used.has(a)) ?? AVATARS[randomInt(AVATARS.length)]!;
    const player: Player = {
      id: randomUUID().slice(0, 8),
      token: randomUUID(),
      name: cleanName,
      avatar,
      color: COLORS[this.players.size % COLORS.length]!,
      score: 0,
      connected: true,
      socketId,
      joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    return { player };
  }

  playerBySocket(socketId: string): Player | undefined {
    for (const p of this.players.values()) if (p.socketId === socketId) return p;
    return undefined;
  }

  disconnect(socketId: string): void {
    if (this.hostSocketId === socketId) {
      this.hostSocketId = null;
      return;
    }
    const p = this.playerBySocket(socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    // Dans le salon, un joueur parti n'a pas à rester affiché.
    if (this.phase === 'lobby') this.players.delete(p.id);
    this.game?.onPlayersChanged();
    this.sync();
  }

  private addBot(): void {
    if (this.players.size >= LIMITS.maxPlayers) return;
    const takenNames = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !takenNames.has(n.toLowerCase())) ?? `Bot #${this.players.size + 1}`;
    const usedAvatars = new Set([...this.players.values()].map((p) => p.avatar));
    const avatar = AVATARS.find((a) => !usedAvatars.has(a)) ?? '🤖';
    const bot: Player = {
      id: randomUUID().slice(0, 8),
      token: randomUUID(),
      name,
      avatar,
      color: COLORS[this.players.size % COLORS.length]!,
      score: 0,
      connected: true,
      isBot: true,
      socketId: null,
      joinedAt: Date.now(),
    };
    this.players.set(bot.id, bot);
  }

  private clearBotTimers(): void {
    for (const t of this.botTimers.values()) clearTimeout(t);
    this.botTimers.clear();
  }

  private scheduleBotMoves(): void {
    if (this.phase !== 'game' || !this.game) {
      this.clearBotTimers();
      return;
    }
    for (const p of this.players.values()) {
      if (!p.isBot || !p.connected) continue;
      const pv = this.game.playerView(p.id);
      if (pv.gameId === 'quiz' && pv.step === 'question' && pv.myAnswer === null) {
        const key = `${p.id}:quiz:${pv.index}`;
        if (this.botTimers.has(key)) continue;
        const delay = 1400 + randomInt(3200);
        this.botTimers.set(
          key,
          setTimeout(() => {
            this.botTimers.delete(key);
            this.gameAction(p.id, { type: 'answer', index: randomInt(4) });
          }, delay),
        );
      } else if (pv.gameId === 'mytho' && pv.step === 'write' && !pv.hasSubmitted) {
        const key = `${p.id}:mytho-w:${pv.round}`;
        if (this.botTimers.has(key)) continue;
        const delay = 1600 + randomInt(2800);
        this.botTimers.set(
          key,
          setTimeout(() => {
            this.botTimers.delete(key);
            const lie = BOT_LIES[randomInt(BOT_LIES.length)]!;
            this.gameAction(p.id, { type: 'lie', text: lie });
          }, delay),
        );
      } else if (pv.gameId === 'mytho' && pv.step === 'vote' && !pv.myVote && pv.options?.length) {
        const key = `${p.id}:mytho-v:${pv.round}`;
        if (this.botTimers.has(key)) continue;
        const opts = pv.options;
        const delay = 1500 + randomInt(2500);
        this.botTimers.set(
          key,
          setTimeout(() => {
            this.botTimers.delete(key);
            const pick = opts[randomInt(opts.length)]!;
            this.gameAction(p.id, { type: 'vote', optionId: pick.id });
          }, delay),
        );
      }
    }
  }

  private kick(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.socketId) {
      this.io.to(p.socketId).emit('kicked');
      this.io.sockets.sockets.get(p.socketId)?.leave(this.code);
    }
    this.players.delete(playerId);
    this.game?.onPlayersChanged();
  }

  /* -------------------------------------------------------------- jeux */

  private makeContext(): GameContext {
    return {
      activePlayers: () => [...this.players.values()].filter((p) => p.connected),
      selectedCategory: () => this.selectedCategory,
      usedItemIds: () => this.usedItems,
      addScore: (id, pts) => {
        const p = this.players.get(id);
        if (p) p.score += pts;
      },
      sync: () => this.sync(),
      finish: () => this.finishGame(),
    };
  }

  private startGame(gameId: GameId): void {
    const def = GAMES[gameId];
    if (!def) return;
    const connected = [...this.players.values()].filter((p) => p.connected).length;
    if (connected < def.info.minPlayers) return;

    this.game?.dispose();
    for (const [id, p] of this.players) {
      if (!p.connected) this.players.delete(id);
      else p.score = 0;
    }
    this.phase = 'game';
    this.lastGameId = gameId;
    this.game = def.create(this.makeContext());
    this.game.start();
  }

  private finishGame(): void {
    this.game?.dispose();
    this.game = null;
    this.phase = 'podium';
    this.sync();
  }

  private toLobby(): void {
    this.game?.dispose();
    this.game = null;
    this.phase = 'lobby';
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.sync();
  }

  control(action: ControlAction): void {
    this.touch();
    switch (action.type) {
      case 'start':
        if (this.phase !== 'game') this.startGame(action.gameId);
        break;
      case 'category':
        if (this.phase !== 'game' && VALID_CATEGORIES.has(action.categoryId)) {
          this.selectedCategory = action.categoryId;
          this.sync();
        }
        break;
      case 'next':
        this.game?.onNext();
        break;
      case 'lobby':
        this.toLobby();
        break;
      case 'add-bot':
        if (this.phase === 'lobby') {
          this.addBot();
          this.sync();
        }
        break;
      case 'kick':
        this.kick(action.playerId);
        this.sync();
        break;
    }
  }

  gameAction(playerId: string, action: GameAction): void {
    this.touch();
    if (this.phase === 'game' && action && typeof action === 'object') this.game?.onPlayerAction(playerId, action);
  }

  /* ------------------------------------------------------ diffusion */

  sync(): void {
    const players: PlayerPublic[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(({ id, name, avatar, color, score, connected, isBot }) => ({ id, name, avatar, color, score, connected, isBot }));
    const base = {
      code: this.code,
      phase: this.phase,
      players,
      vipId: this.vipId,
      games: GAME_LIST,
      categories: CATEGORIES,
      selectedCategory: this.selectedCategory,
      lastGameId: this.lastGameId,
      serverNow: Date.now(),
    };
    if (this.hostSocketId) {
      this.io.to(this.hostSocketId).emit('state', { ...base, role: 'host', game: this.game?.hostView() ?? null });
    }
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit('state', { ...base, role: 'player', meId: p.id, game: this.game?.playerView(p.id) ?? null });
    }
    this.scheduleBotMoves();
  }

  hasHumansConnected(): boolean {
    if (this.hostSocketId) return true;
    for (const p of this.players.values()) {
      if (p.connected && !p.isBot) return true;
    }
    return false;
  }

  close(reason: string): void {
    this.clearBotTimers();
    this.game?.dispose();
    this.io.to(this.code).emit('closed', reason);
  }
}

const MAX_ROOMS = 500;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: IO) {
    // Ménage automatique :
    // - Salles abandonnées (aucun humain connecté) depuis 15 min
    // - Salles inactives depuis 2 h
    setInterval(() => {
      const now = Date.now();
      const idleLimit = now - 2 * 60 * 60 * 1000;
      const abandonedLimit = now - 15 * 60 * 1000;
      for (const [code, room] of this.rooms) {
        const abandoned = !room.hasHumansConnected() && room.lastActivity < abandonedLimit;
        if (abandoned || room.lastActivity < idleLimit) {
          room.close('Partie fermée pour inactivité.');
          this.rooms.delete(code);
        }
      }
    }, 60_000).unref();
  }

  create(): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code: string;
    do {
      code = Array.from({ length: LIMITS.codeLength }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.io);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(String(code ?? '').toUpperCase().trim());
  }

  get size(): number {
    return this.rooms.size;
  }

  get totalPlayers(): number {
    let total = 0;
    for (const r of this.rooms.values()) {
      for (const p of r.players.values()) if (p.connected) total++;
    }
    return total;
  }

  closeAll(reason: string): void {
    for (const r of this.rooms.values()) r.close(reason);
    this.rooms.clear();
  }
}
