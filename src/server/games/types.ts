import type { CategoryId, GameAction, GameHostView, GameId, GameInfo, GamePlayerView } from '../../shared/protocol.js';

export interface GamePlayer {
  id: string;
  name: string;
  connected: boolean;
}

/** Ce que la salle met à disposition d'un mini-jeu. */
export interface GameContext {
  /** Joueurs actuellement connectés (ceux dont on attend une réponse). */
  activePlayers(): GamePlayer[];
  /** Catégorie thématique choisie dans le salon. */
  selectedCategory(): CategoryId;
  /** IDs des questions/anecdotes déjà tirées dans ce salon pour éviter les doublons. */
  usedItemIds(): Set<string>;
  addScore(playerId: string, points: number): void;
  /** Pousse l'état à jour à tous les écrans. */
  sync(): void;
  /** Termine le mini-jeu et affiche le podium. */
  finish(): void;
}

export interface MiniGame {
  readonly id: GameId;
  start(): void;
  onPlayerAction(playerId: string, action: GameAction): void;
  /** Bouton "Suivant" de l'hôte ou du VIP : passe l'étape en cours. */
  onNext(): void;
  /** Un joueur s'est (dé)connecté : permet de ne pas attendre un absent. */
  onPlayersChanged(): void;
  hostView(): GameHostView;
  playerView(playerId: string): GamePlayerView;
  dispose(): void;
}

export interface GameDefinition {
  info: GameInfo;
  create(ctx: GameContext): MiniGame;
}

/** Gestion des minuteurs annulables, commune à tous les jeux. */
export abstract class BaseGame {
  private timers = new Set<NodeJS.Timeout>();
  private disposed = false;

  protected after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }

  protected clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }
}

export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
