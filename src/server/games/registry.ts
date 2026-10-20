import type { GameId, GameInfo } from '../../shared/protocol.js';
import { mythoGame } from './mytho.js';
import { quizGame } from './quiz.js';
import type { GameDefinition } from './types.js';

/** Pour ajouter un mini-jeu : créer un fichier qui exporte une GameDefinition et l'ajouter ici. */
export const GAMES: Record<GameId, GameDefinition> = {
  quiz: quizGame,
  mytho: mythoGame,
};

export const GAME_LIST: GameInfo[] = Object.values(GAMES).map((g) => g.info);
