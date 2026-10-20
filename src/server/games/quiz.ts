import type { GameAction, ItemCategoryId, QuizGain, QuizHostView, QuizPlayerView, QuizStep } from '../../shared/protocol.js';
import { ITEM_CATEGORIES, pickBalancedItems } from './content/categories.js';
import { QUIZ_QUESTIONS } from './content/quiz-questions.js';
import { BaseGame, shuffle, type GameContext, type GameDefinition, type MiniGame } from './types.js';

const QUESTIONS_PER_GAME = 8;
const INTRO_MS = 4_000;
const QUESTION_MS = 20_000;
const REVEAL_MS = 8_000;

interface PreparedQuestion {
  category: ItemCategoryId;
  difficulty: 1 | 2 | 3;
  question: string;
  choices: string[];
  correctIndex: number;
  fact: string;
}

class QuizGame extends BaseGame implements MiniGame {
  readonly id = 'quiz' as const;

  private readonly questions: PreparedQuestion[];
  private step: QuizStep = 'intro';
  private index = -1;
  private endsAt = 0;
  private startedAt = 0;
  private answers = new Map<string, { index: number; at: number }>();
  private gains = new Map<string, QuizGain>();
  private streaks = new Map<string, number>();

  constructor(private readonly ctx: GameContext) {
    super();
    const picked = pickBalancedItems(
      QUIZ_QUESTIONS,
      ctx.selectedCategory(),
      QUESTIONS_PER_GAME,
      ctx.usedItemIds(),
    );
    this.questions = picked.map((q) => {
      const choices = shuffle(q.answers);
      return {
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        choices,
        correctIndex: choices.indexOf(q.answers[0]),
        fact: q.fact,
      };
    });
  }

  private get current(): PreparedQuestion | null {
    return this.questions[this.index] ?? null;
  }

  start(): void {
    this.step = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    this.after(INTRO_MS, () => this.nextQuestion());
    this.ctx.sync();
  }

  private nextQuestion(): void {
    this.clearTimers();
    this.index++;
    if (this.index >= this.questions.length) {
      this.ctx.finish();
      return;
    }
    this.step = 'question';
    this.answers.clear();
    this.gains.clear();
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + QUESTION_MS;
    this.after(QUESTION_MS, () => this.reveal());
    this.ctx.sync();
  }

  private reveal(): void {
    const q = this.current;
    if (!q) return;
    this.clearTimers();
    this.step = 'reveal';

    const participants = new Set([...this.ctx.activePlayers().map((p) => p.id), ...this.answers.keys()]);
    for (const playerId of participants) {
      const answer = this.answers.get(playerId);
      const correct = answer?.index === q.correctIndex;
      const streak = correct ? (this.streaks.get(playerId) ?? 0) + 1 : 0;
      this.streaks.set(playerId, streak);
      let points = 0;
      if (correct && answer) {
        const speed = 1 - Math.min(1, (answer.at - this.startedAt) / QUESTION_MS);
        points = Math.round(500 + 500 * speed) + Math.min(streak - 1, 5) * 100;
        this.ctx.addScore(playerId, points);
      }
      this.gains.set(playerId, { playerId, points, correct, streak });
    }

    this.endsAt = Date.now() + REVEAL_MS;
    this.after(REVEAL_MS, () => this.nextQuestion());
    this.ctx.sync();
  }

  private allAnswered(): boolean {
    const active = this.ctx.activePlayers();
    return active.length > 0 && active.every((p) => this.answers.has(p.id));
  }

  onPlayerAction(playerId: string, action: GameAction): void {
    if (action.type !== 'answer' || this.step !== 'question') return;
    if (this.answers.has(playerId)) return;
    if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3) return;
    this.answers.set(playerId, { index: action.index, at: Date.now() });
    if (this.allAnswered()) this.reveal();
    else this.ctx.sync();
  }

  onNext(): void {
    if (this.step === 'question') this.reveal();
    else this.nextQuestion();
  }

  onPlayersChanged(): void {
    if (this.step === 'question' && this.allAnswered()) this.reveal();
  }

  hostView(): QuizHostView {
    const q = this.current;
    const showQuestion = this.step !== 'intro' && q;
    const cat = showQuestion ? ITEM_CATEGORIES[q.category] : null;
    let counts: number[] | null = null;
    if (this.step === 'reveal') {
      counts = [0, 0, 0, 0];
      for (const a of this.answers.values()) counts[a.index]!++;
    }
    return {
      gameId: 'quiz',
      step: this.step,
      index: this.index,
      total: this.questions.length,
      endsAt: this.endsAt,
      categoryName: cat?.name ?? null,
      categoryEmoji: cat?.emoji ?? null,
      difficulty: showQuestion ? q.difficulty : null,
      question: showQuestion ? q.question : null,
      choices: showQuestion ? q.choices : null,
      answeredIds: [...this.answers.keys()],
      correctIndex: this.step === 'reveal' && q ? q.correctIndex : null,
      fact: this.step === 'reveal' && q ? q.fact : null,
      counts,
      gains: this.step === 'reveal' ? [...this.gains.values()].sort((a, b) => b.points - a.points) : null,
    };
  }

  playerView(playerId: string): QuizPlayerView {
    const q = this.current;
    const showQuestion = this.step !== 'intro' && q;
    const cat = showQuestion ? ITEM_CATEGORIES[q.category] : null;
    return {
      gameId: 'quiz',
      step: this.step,
      index: this.index,
      total: this.questions.length,
      endsAt: this.endsAt,
      categoryName: cat?.name ?? null,
      categoryEmoji: cat?.emoji ?? null,
      difficulty: showQuestion ? q.difficulty : null,
      question: showQuestion ? q.question : null,
      choices: showQuestion ? q.choices : null,
      myAnswer: this.answers.get(playerId)?.index ?? null,
      correctIndex: this.step === 'reveal' && q ? q.correctIndex : null,
      fact: this.step === 'reveal' && q ? q.fact : null,
      myGain: this.step === 'reveal' ? (this.gains.get(playerId) ?? null) : null,
    };
  }
}

export const quizGame: GameDefinition = {
  info: {
    id: 'quiz',
    name: 'Quiz Express',
    emoji: '⚡',
    tagline: 'Culture G & Afrique en rafale. Plus tu réponds vite, plus tu marques !',
    minPlayers: 1,
  },
  create: (ctx) => new QuizGame(ctx),
};
