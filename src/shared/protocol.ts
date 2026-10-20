/**
 * Contrat partagé entre le serveur et les clients (écran hôte + manettes téléphone).
 * Le serveur est la seule source de vérité : il pousse une "vue" complète à chaque changement.
 */

export type GameId = 'quiz' | 'mytho';
export type RoomPhase = 'lobby' | 'game' | 'podium';

export type ItemCategoryId =
  | 'afrique-histoire'
  | 'afrique-culture'
  | 'afrique-cuisine'
  | 'sport'
  | 'sciences-nature'
  | 'monde-insolite';

export type CategoryId = 'all' | 'afrique-pack' | ItemCategoryId;

export interface CategoryInfo {
  id: CategoryId;
  name: string;
  emoji: string;
  description: string;
  quizCount: number;
  mythoCount: number;
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  connected: boolean;
  isBot?: boolean;
}

export interface GameInfo {
  id: GameId;
  name: string;
  emoji: string;
  tagline: string;
  minPlayers: number;
}

interface BaseView {
  code: string;
  phase: RoomPhase;
  players: PlayerPublic[];
  vipId: string | null;
  games: GameInfo[];
  categories: CategoryInfo[];
  selectedCategory: CategoryId;
  lastGameId: GameId | null;
  /** Horloge serveur au moment de l'envoi, pour recaler les comptes à rebours. */
  serverNow: number;
}

export interface HostView extends BaseView {
  role: 'host';
  game: GameHostView | null;
}

export interface PlayerView extends BaseView {
  role: 'player';
  meId: string;
  game: GamePlayerView | null;
}

export type AnyView = HostView | PlayerView;

/* ------------------------------------------------------------------ Quiz */

export type QuizStep = 'intro' | 'question' | 'reveal';

export interface QuizGain {
  playerId: string;
  points: number;
  correct: boolean;
  streak: number;
}

export interface QuizHostView {
  gameId: 'quiz';
  step: QuizStep;
  index: number;
  total: number;
  endsAt: number;
  categoryName: string | null;
  categoryEmoji: string | null;
  difficulty: 1 | 2 | 3 | null;
  question: string | null;
  choices: string[] | null;
  answeredIds: string[];
  correctIndex: number | null;
  fact: string | null;
  counts: number[] | null;
  gains: QuizGain[] | null;
}

export interface QuizPlayerView {
  gameId: 'quiz';
  step: QuizStep;
  index: number;
  total: number;
  endsAt: number;
  categoryName: string | null;
  categoryEmoji: string | null;
  difficulty: 1 | 2 | 3 | null;
  question: string | null;
  choices: string[] | null;
  myAnswer: number | null;
  correctIndex: number | null;
  fact: string | null;
  myGain: QuizGain | null;
}

/* ----------------------------------------------------------------- Mytho */

export type MythoStep = 'intro' | 'write' | 'vote' | 'reveal';

export interface MythoOption {
  id: string;
  text: string;
}

export interface MythoRevealItem extends MythoOption {
  isTruth: boolean;
  /** Vide pour un mensonge "de la maison". */
  authorIds: string[];
  voterIds: string[];
}

export interface MythoResult {
  foundTruth: boolean;
  fooled: number;
  gained: number;
}

export interface MythoHostView {
  gameId: 'mytho';
  step: MythoStep;
  round: number;
  totalRounds: number;
  multiplier: number;
  endsAt: number;
  categoryName: string | null;
  categoryEmoji: string | null;
  prompt: string | null;
  fact: string | null;
  submittedIds: string[];
  votedIds: string[];
  options: MythoOption[] | null;
  reveal: MythoRevealItem[] | null;
  gains: Record<string, number> | null;
}

export interface MythoPlayerView {
  gameId: 'mytho';
  step: MythoStep;
  round: number;
  totalRounds: number;
  multiplier: number;
  endsAt: number;
  categoryName: string | null;
  categoryEmoji: string | null;
  prompt: string | null;
  fact: string | null;
  hasSubmitted: boolean;
  error: string | null;
  options: MythoOption[] | null;
  myVote: string | null;
  result: MythoResult | null;
  truth: string | null;
}

export type GameHostView = QuizHostView | MythoHostView;
export type GamePlayerView = QuizPlayerView | MythoPlayerView;

/* --------------------------------------------------------------- Actions */

export type QuizAction = { type: 'answer'; index: number };
export type MythoAction = { type: 'lie'; text: string } | { type: 'vote'; optionId: string };
export type GameAction = QuizAction | MythoAction;

/** Actions de pilotage, autorisées pour l'écran hôte et pour le joueur VIP (👑). */
export type ControlAction =
  | { type: 'start'; gameId: GameId }
  | { type: 'category'; categoryId: CategoryId }
  | { type: 'next' }
  | { type: 'lobby' }
  | { type: 'add-bot' }
  | { type: 'kick'; playerId: string };

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'host:create': (cb: (res: Ack<{ code: string; hostToken: string }>) => void) => void;
  'host:resume': (p: { code: string; hostToken: string }, cb: (res: Ack) => void) => void;
  'player:join': (
    p: { code: string; name: string; token?: string },
    cb: (res: Ack<{ playerId: string; token: string }>) => void,
  ) => void;
  'room:control': (action: ControlAction) => void;
  'game:action': (action: GameAction) => void;
}

export interface ServerToClientEvents {
  state: (view: AnyView) => void;
  kicked: () => void;
  closed: (reason: string) => void;
}

export const LIMITS = {
  maxPlayers: 12,
  nameMax: 16,
  lieMax: 40,
  codeLength: 4,
} as const;
