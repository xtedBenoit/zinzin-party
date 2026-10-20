import type { CategoryId, CategoryInfo, ItemCategoryId } from '../../../shared/protocol.js';
import { shuffle } from '../types.js';

export interface CategoryMeta {
  id: ItemCategoryId;
  name: string;
  emoji: string;
  description: string;
  africanFocus: boolean;
}

export const ITEM_CATEGORIES: Record<ItemCategoryId, CategoryMeta> = {
  'afrique-histoire': {
    id: 'afrique-histoire',
    name: 'Afrique : Histoire & Géo',
    emoji: '👑',
    description: 'Grands empires, figures historiques, capitales, fleuves et langues du continent.',
    africanFocus: true,
  },
  'afrique-culture': {
    id: 'afrique-culture',
    name: 'Musique & Pop Culture Afro',
    emoji: '🎶',
    description: 'Afrobeats, Rumba, Coupé-décalé, légendes musicales, cinéma FESPACO & Nollywood.',
    africanFocus: true,
  },
  'afrique-cuisine': {
    id: 'afrique-cuisine',
    name: 'Cuisine & Traditions',
    emoji: '🍲',
    description: 'Plats emblématiques (Thiéboudienne, Attiéké, Ndolé, Jollof…), boissons, tissus et savoirs.',
    africanFocus: true,
  },
  sport: {
    id: 'sport',
    name: 'Sport & Légendes Africaines',
    emoji: '⚽',
    description: 'CAN, Ballons d’Or, épopées de Coupe du monde, athlétisme, NBA et arts martiaux.',
    africanFocus: true,
  },
  'sciences-nature': {
    id: 'sciences-nature',
    name: 'Sciences, Faune & Nature',
    emoji: '🦁',
    description: 'Faune sauvage africaine, parcs mythiques, berceau de l’humanité, espace et sciences.',
    africanFocus: true,
  },
  'monde-insolite': {
    id: 'monde-insolite',
    name: 'Monde & Insolite',
    emoji: '🌐',
    description: 'Culture générale mondiale, inventions, cinéma, records et faits complètement fous.',
    africanFocus: false,
  },
};

export interface CategorizedItem {
  id: string;
  category: ItemCategoryId;
  difficulty: 1 | 2 | 3;
}

export function matchesCategory(item: CategorizedItem, selected: CategoryId): boolean {
  if (selected === 'all') return true;
  if (selected === 'afrique-pack') return ITEM_CATEGORIES[item.category].africanFocus;
  return item.category === selected;
}

export function buildCategoryList(
  quizItems: readonly CategorizedItem[],
  mythoItems: readonly CategorizedItem[],
): CategoryInfo[] {
  const countFor = (id: CategoryId) => ({
    quizCount: quizItems.filter((q) => matchesCategory(q, id)).length,
    mythoCount: mythoItems.filter((m) => matchesCategory(m, id)).length,
  });

  return [
    {
      id: 'afrique-pack',
      name: '100 % Afrique (Mix)',
      emoji: '🌍',
      description: 'Histoire, musiques, gastronomie, sport et faune du continent africain.',
      ...countFor('afrique-pack'),
    },
    {
      id: 'all',
      name: 'Grand Mix (Tout)',
      emoji: '🎲',
      description: 'Toutes les catégories mélangées : Afrique, sport, sciences et insolite mondial.',
      ...countFor('all'),
    },
    ...Object.values(ITEM_CATEGORIES).map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      description: c.description,
      ...countFor(c.id),
    })),
  ];
}

/**
 * Sélectionne `count` éléments :
 * - Priorise les questions jamais jouées dans ce salon (`usedIds`),
 * - Équilibre la courbe de difficulté (1 → 2 → 3),
 * - Varie les sous-catégories en mode Mix.
 */
export function pickBalancedItems<T extends CategorizedItem>(
  allItems: readonly T[],
  selectedCategory: CategoryId,
  count: number,
  usedIds: Set<string>,
): T[] {
  const pool = allItems.filter((item) => matchesCategory(item, selectedCategory));
  let candidates = shuffle(pool.filter((item) => !usedIds.has(item.id)));

  if (candidates.length < count) {
    // On a fait le tour de cette catégorie : on réinitialise les IDs de ce filtre et on complète.
    const freshIds = new Set(candidates.map((c) => c.id));
    for (const item of pool) {
      if (!freshIds.has(item.id)) usedIds.delete(item.id);
    }
    const recycled = shuffle(pool.filter((item) => !freshIds.has(item.id)));
    candidates = [...candidates, ...recycled];
  }

  // Répartition cible par difficulté (ex. sur 8 questions : 3 faciles, 3 moyennes, 2 corsées).
  const target1 = Math.ceil(count * 0.38);
  const target2 = Math.ceil(count * 0.38);
  const target3 = Math.max(0, count - target1 - target2);

  const byDiff = (d: 1 | 2 | 3) => diversifyByCategory(candidates.filter((c) => c.difficulty === d));
  const d1 = byDiff(1);
  const d2 = byDiff(2);
  const d3 = byDiff(3);

  const picked: T[] = [];
  const pickedIds = new Set<string>();
  const takeFrom = (list: T[], max: number) => {
    for (const item of list) {
      if (picked.length >= count || max <= 0) break;
      if (pickedIds.has(item.id)) continue;
      picked.push(item);
      pickedIds.add(item.id);
      max--;
    }
  };

  takeFrom(d1, target1);
  takeFrom(d2, target2);
  takeFrom(d3, target3);

  // Complète si un palier de difficulté avait moins d'éléments que prévu.
  if (picked.length < count) {
    takeFrom(diversifyByCategory(candidates), count - picked.length);
  }

  // Trie du plus accessible au plus relevé pour une vraie montée en tension.
  picked.sort((a, b) => a.difficulty - b.difficulty);
  for (const item of picked) usedIds.add(item.id);
  return picked;
}

/** Alterne les catégories pour éviter d'enchaîner 4 questions du même thème en mode Mix. */
function diversifyByCategory<T extends CategorizedItem>(items: T[]): T[] {
  const buckets = new Map<ItemCategoryId, T[]>();
  for (const item of items) {
    let b = buckets.get(item.category);
    if (!b) buckets.set(item.category, (b = []));
    b.push(item);
  }
  const result: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const b of shuffle([...buckets.values()])) {
      const next = b.shift();
      if (next) {
        result.push(next);
        added = true;
      }
    }
  }
  return result;
}
