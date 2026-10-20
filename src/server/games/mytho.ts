import type {
  GameAction,
  MythoHostView,
  MythoOption,
  MythoPlayerView,
  MythoResult,
  MythoRevealItem,
  MythoStep,
} from '../../shared/protocol.js';
import { LIMITS } from '../../shared/protocol.js';
import { ITEM_CATEGORIES, pickBalancedItems } from './content/categories.js';
import { MYTHO_PROMPTS, type MythoPrompt } from './content/mytho-prompts.js';
import { BaseGame, shuffle, type GameContext, type GameDefinition, type MiniGame } from './types.js';

const TOTAL_ROUNDS = 3;
const INTRO_MS = 8_000;
const WRITE_MS = 60_000;
const VOTE_MS = 30_000;
const REVEAL_MS = 14_000;
const MIN_OPTIONS = 4;
const POINTS_TRUTH = 1000;
const POINTS_PER_FOOLED = 500;

/** Normalise une réponse pour comparer "La Chaleur !" et "chaleur". */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd'].includes(w))
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .join(' ')
    .trim();
}

interface OptionInternal extends MythoOption {
  isTruth: boolean;
  authorIds: string[];
  norm: string;
}

class MythoGame extends BaseGame implements MiniGame {
  readonly id = 'mytho' as const;

  private readonly prompts: MythoPrompt[];
  private step: MythoStep = 'intro';
  private round = 0;
  private endsAt = 0;
  private lies = new Map<string, string>();
  private errors = new Map<string, string>();
  private options: OptionInternal[] = [];
  private votes = new Map<string, string>();
  private results = new Map<string, MythoResult>();

  constructor(private readonly ctx: GameContext) {
    super();
    this.prompts = pickBalancedItems(
      MYTHO_PROMPTS,
      ctx.selectedCategory(),
      TOTAL_ROUNDS,
      ctx.usedItemIds(),
    );
  }

  private get prompt(): MythoPrompt | null {
    return this.prompts[this.round - 1] ?? null;
  }

  private get multiplier(): number {
    return this.round === TOTAL_ROUNDS ? 2 : 1;
  }

  start(): void {
    this.step = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    this.after(INTRO_MS, () => this.startRound());
    this.ctx.sync();
  }

  private startRound(): void {
    this.clearTimers();
    this.round++;
    if (this.round > this.prompts.length) {
      this.ctx.finish();
      return;
    }
    this.step = 'write';
    this.lies.clear();
    this.errors.clear();
    this.votes.clear();
    this.results.clear();
    this.options = [];
    this.endsAt = Date.now() + WRITE_MS;
    this.after(WRITE_MS, () => this.startVote());
    this.ctx.sync();
  }

  private isTooCloseToTruth(norm: string): boolean {
    const p = this.prompt!;
    const withoutParen = p.truth.replace(/\(.*?\)/g, '');
    return [p.truth, withoutParen, ...(p.aliases ?? [])].some((t) => normalizeAnswer(t) === norm);
  }

  private startVote(): void {
    const p = this.prompt;
    if (!p) return;
    this.clearTimers();

    // Regroupe les mensonges identiques : leurs auteurs se partagent la même carte.
    const byNorm = new Map<string, OptionInternal>();
    let n = 0;
    for (const [playerId, text] of this.lies) {
      const norm = normalizeAnswer(text);
      const existing = byNorm.get(norm);
      if (existing) existing.authorIds.push(playerId);
      else byNorm.set(norm, { id: `o${n++}`, text, norm, isTruth: false, authorIds: [playerId] });
    }
    const options = [...byNorm.values()];
    options.push({ id: `o${n++}`, text: p.truth, norm: normalizeAnswer(p.truth), isTruth: true, authorIds: [] });

    // Complète avec des mensonges "maison" pour garder du suspense à peu de joueurs.
    for (const decoy of shuffle(p.decoys)) {
      if (options.length >= MIN_OPTIONS) break;
      const norm = normalizeAnswer(decoy);
      if (options.some((o) => o.norm === norm)) continue;
      options.push({ id: `o${n++}`, text: decoy, norm, isTruth: false, authorIds: [] });
    }

    this.options = shuffle(options);
    this.step = 'vote';
    this.endsAt = Date.now() + VOTE_MS;
    this.after(VOTE_MS, () => this.reveal());
    this.ctx.sync();
  }

  private reveal(): void {
    this.clearTimers();
    this.step = 'reveal';
    const mult = this.multiplier;
    const gained = new Map<string, MythoResult>();
    const resultFor = (id: string) => {
      let r = gained.get(id);
      if (!r) gained.set(id, (r = { foundTruth: false, fooled: 0, gained: 0 }));
      return r;
    };

    for (const p of this.ctx.activePlayers()) resultFor(p.id);
    for (const authorId of this.lies.keys()) resultFor(authorId);

    for (const [voterId, optionId] of this.votes) {
      const option = this.options.find((o) => o.id === optionId);
      if (!option) continue;
      if (option.isTruth) {
        const r = resultFor(voterId);
        r.foundTruth = true;
        r.gained += POINTS_TRUTH * mult;
      } else {
        for (const authorId of option.authorIds) {
          const r = resultFor(authorId);
          r.fooled++;
          r.gained += POINTS_PER_FOOLED * mult;
        }
      }
    }
    for (const [id, r] of gained) if (r.gained) this.ctx.addScore(id, r.gained);
    this.results = gained;

    this.endsAt = Date.now() + REVEAL_MS;
    this.after(REVEAL_MS, () => this.startRound());
    this.ctx.sync();
  }

  private votableFor(playerId: string): OptionInternal[] {
    return this.options.filter((o) => !o.authorIds.includes(playerId));
  }

  onPlayerAction(playerId: string, action: GameAction): void {
    if (action.type === 'lie' && this.step === 'write') {
      if (this.lies.has(playerId)) return;
      const text = String(action.text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.lieMax);
      const norm = normalizeAnswer(text);
      if (!norm) {
        this.errors.set(playerId, 'Écris au moins un mot !');
      } else if (this.isTooCloseToTruth(norm)) {
        this.errors.set(playerId, "Bien vu… c'est la vérité ! 😱 Invente plutôt un mensonge.");
      } else {
        this.errors.delete(playerId);
        this.lies.set(playerId, text);
        if (this.ctx.activePlayers().every((p) => this.lies.has(p.id))) {
          this.startVote();
          return;
        }
      }
      this.ctx.sync();
      return;
    }

    if (action.type === 'vote' && this.step === 'vote') {
      if (this.votes.has(playerId)) return;
      if (!this.votableFor(playerId).some((o) => o.id === action.optionId)) return;
      this.votes.set(playerId, action.optionId);
      if (this.allVoted()) this.reveal();
      else this.ctx.sync();
    }
  }

  private allVoted(): boolean {
    const active = this.ctx.activePlayers();
    return active.length > 0 && active.every((p) => this.votes.has(p.id));
  }

  onNext(): void {
    switch (this.step) {
      case 'intro':
      case 'reveal':
        this.startRound();
        break;
      case 'write':
        this.startVote();
        break;
      case 'vote':
        this.reveal();
        break;
    }
  }

  onPlayersChanged(): void {
    const active = this.ctx.activePlayers();
    if (this.step === 'write' && active.length > 0 && active.every((p) => this.lies.has(p.id))) this.startVote();
    else if (this.step === 'vote' && this.allVoted()) this.reveal();
  }

  private revealItems(): MythoRevealItem[] {
    const items = this.options.map<MythoRevealItem>((o) => ({
      id: o.id,
      text: o.text,
      isTruth: o.isTruth,
      authorIds: o.authorIds,
      voterIds: [...this.votes].filter(([, v]) => v === o.id).map(([k]) => k),
    }));
    // Suspense : les mensonges d'abord (les moins votés en premier), la vérité à la fin.
    return items.sort((a, b) => Number(a.isTruth) - Number(b.isTruth) || a.voterIds.length - b.voterIds.length);
  }

  hostView(): MythoHostView {
    const p = this.prompt;
    const cat = this.step !== 'intro' && p ? ITEM_CATEGORIES[p.category] : null;
    return {
      gameId: 'mytho',
      step: this.step,
      round: this.round,
      totalRounds: this.prompts.length,
      multiplier: this.multiplier,
      endsAt: this.endsAt,
      categoryName: cat?.name ?? null,
      categoryEmoji: cat?.emoji ?? null,
      prompt: p?.prompt ?? null,
      fact: this.step === 'reveal' && p ? p.fact : null,
      submittedIds: [...this.lies.keys()],
      votedIds: [...this.votes.keys()],
      options: this.step === 'vote' ? this.options.map(({ id, text }) => ({ id, text })) : null,
      reveal: this.step === 'reveal' ? this.revealItems() : null,
      gains: this.step === 'reveal' ? Object.fromEntries([...this.results].map(([id, r]) => [id, r.gained])) : null,
    };
  }

  playerView(playerId: string): MythoPlayerView {
    const p = this.prompt;
    const cat = this.step !== 'intro' && p ? ITEM_CATEGORIES[p.category] : null;
    return {
      gameId: 'mytho',
      step: this.step,
      round: this.round,
      totalRounds: this.prompts.length,
      multiplier: this.multiplier,
      endsAt: this.endsAt,
      categoryName: cat?.name ?? null,
      categoryEmoji: cat?.emoji ?? null,
      prompt: p?.prompt ?? null,
      fact: this.step === 'reveal' && p ? p.fact : null,
      hasSubmitted: this.lies.has(playerId),
      error: this.errors.get(playerId) ?? null,
      options: this.step === 'vote' ? this.votableFor(playerId).map(({ id, text }) => ({ id, text })) : null,
      myVote: this.votes.get(playerId) ?? null,
      result: this.step === 'reveal' ? (this.results.get(playerId) ?? { foundTruth: false, fooled: 0, gained: 0 }) : null,
      truth: this.step === 'reveal' ? (p?.truth ?? null) : null,
    };
  }
}

export const mythoGame: GameDefinition = {
  info: {
    id: 'mytho',
    name: 'Le Mytho',
    emoji: '🤥',
    tagline: 'Invente un faux fait crédible, piège tes potes et débusque la vraie réponse.',
    minPlayers: 2,
  },
  create: (ctx) => new MythoGame(ctx),
};
