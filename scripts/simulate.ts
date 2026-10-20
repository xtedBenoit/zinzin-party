/**
 * Simulation de bout en bout : un écran hôte + 3 joueurs robots jouent au Quiz puis au Mytho.
 * Usage : lancer le serveur (npm run dev:server) puis `npm run simulate`.
 */
import { io, type Socket } from 'socket.io-client';
import { MYTHO_PROMPTS } from '../src/server/games/content/mytho-prompts.js';
import { QUIZ_QUESTIONS } from '../src/server/games/content/quiz-questions.js';
import type {
  AnyView,
  ClientToServerEvents,
  HostView,
  PlayerView,
  ServerToClientEvents,
} from '../src/shared/protocol.js';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const URL = process.env.URL ?? 'http://localhost:3000';

const connectSocket = () =>
  new Promise<S>((resolve) => {
    const s: S = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });

function waitFor<V extends AnyView>(s: S, pred: (v: V) => boolean, label: string, timeout = 90_000): Promise<V> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeout);
    const onState = (v: AnyView) => {
      if (pred(v as V)) {
        clearTimeout(t);
        s.off('state', onState);
        resolve(v as V);
      }
    };
    s.on('state', onState);
  });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`✅ ${msg}`);
}

function validateContentBank(): void {
  const quizIds = new Set<string>();
  for (const q of QUIZ_QUESTIONS) {
    if (quizIds.has(q.id)) throw new Error(`ID Quiz en double : ${q.id}`);
    quizIds.add(q.id);
    if (new Set(q.answers).size !== 4) throw new Error(`Réponses non uniques dans ${q.id}`);
    if (!q.question.trim() || !q.fact.trim()) throw new Error(`Question ou fact vide dans ${q.id}`);
  }
  const mythoIds = new Set<string>();
  for (const m of MYTHO_PROMPTS) {
    if (mythoIds.has(m.id)) throw new Error(`ID Mytho en double : ${m.id}`);
    mythoIds.add(m.id);
    if (!m.prompt.includes('___')) throw new Error(`Trou ___ manquant dans ${m.id}`);
    if (m.decoys.length < 3 || !m.fact.trim()) throw new Error(`Leurres ou fact manquants dans ${m.id}`);
  }
  assert(
    QUIZ_QUESTIONS.length >= 100 && MYTHO_PROMPTS.length >= 40,
    `Banque validée : ${QUIZ_QUESTIONS.length} questions Quiz et ${MYTHO_PROMPTS.length} anecdotes Mytho (0 doublon)`,
  );
}

async function main() {
  validateContentBank();
  const host = await connectSocket();
  const created = await new Promise<{ code: string }>((resolve, reject) =>
    host.emit('host:create', (res) => (res.ok ? resolve(res) : reject(new Error(res.error)))),
  );
  const code = created.code;
  assert(/^[A-Z]{4}$/.test(code), `Salle créée : ${code}`);

  const names = ['Alice', 'Bob', 'Chloé'];
  const players: { s: S; id: string; name: string; token: string }[] = [];
  for (const name of names) {
    const s = await connectSocket();
    const res = await new Promise<{ playerId: string; token: string }>((resolve, reject) =>
      s.emit('player:join', { code, name }, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))),
    );
    players.push({ s, id: res.playerId, name, token: res.token });
  }

  const dup = await connectSocket();
  const dupRes = await new Promise<{ ok: boolean }>((r) => dup.emit('player:join', { code, name: 'alice' }, r));
  assert(!dupRes.ok, 'Pseudo en double refusé');
  dup.close();

  const other = await connectSocket();
  const bad = await new Promise<{ ok: boolean }>((r) => other.emit('player:join', { code: 'ZZZZ', name: 'X' }, r));
  assert(!bad.ok, 'Code inconnu refusé');
  other.close();

  // Un non-VIP ne peut pas lancer la partie.
  players[1]!.s.emit('room:control', { type: 'start', gameId: 'quiz' });
  await new Promise((r) => setTimeout(r, 300));

  const lobby = await new Promise<HostView>((resolve) => {
    host.once('state', (v) => resolve(v as HostView));
    host.emit('room:control', { type: 'kick', playerId: 'nobody' }); // force un sync
  });
  assert(lobby.phase === 'lobby' && lobby.players.length === 3, 'Salon : 3 joueurs, toujours au salon');
  assert(lobby.vipId === players[0]!.id, 'Alice est VIP 👑');
  assert(lobby.selectedCategory === 'afrique-pack' && lobby.categories.length === 8, '8 catégories disponibles (défaut : 100 % Afrique)');

  // Alice (VIP) sélectionne la catégorie "afrique-cuisine"
  players[0]!.s.emit('room:control', { type: 'category', categoryId: 'afrique-cuisine' });
  const catLobby = await waitFor<HostView>(host, (v) => v.selectedCategory === 'afrique-cuisine', 'changement de catégorie');
  assert(catLobby.selectedCategory === 'afrique-cuisine', 'Catégorie « Cuisine & Traditions » sélectionnée par le VIP');

  /* -------------------------------------------------------------- QUIZ */
  // Robots : Alice répond toujours juste (triche via la vue de révélation impossible → elle répond 0),
  // on vérifie surtout le cycle question → révélation → podium.
  let questionsSeen = 0;
  for (const p of players) {
    p.s.on('state', (v) => {
      const pv = v as PlayerView;
      if (pv.game?.gameId === 'quiz' && pv.game.step === 'question' && pv.game.myAnswer === null) {
        p.s.emit('game:action', { type: 'answer', index: Math.floor(Math.random() * 4) });
      }
    });
  }
  host.on('state', (v) => {
    const hv = v as HostView;
    if (hv.game?.gameId === 'quiz' && hv.game.step === 'reveal') {
      assert(
        hv.game.categoryName === 'Cuisine & Traditions' && Boolean(hv.game.fact),
        `Question ${hv.game.index + 1} bien filtrée (${hv.game.categoryName}) + anecdote affichée`,
      );
      questionsSeen = Math.max(questionsSeen, hv.game.index + 1);
      // On accélère : l'hôte passe la révélation.
      setTimeout(() => host.emit('room:control', { type: 'next' }), 50);
    }
    if (hv.game?.gameId === 'quiz' && hv.game.step === 'intro') host.emit('room:control', { type: 'next' });
  });

  players[0]!.s.emit('room:control', { type: 'start', gameId: 'quiz' }); // lancé par le VIP
  const quizEnd = await waitFor<HostView>(host, (v) => v.phase === 'podium', 'fin du quiz');
  assert(questionsSeen === 8, `Quiz : 8 questions jouées`);
  const total = quizEnd.players.reduce((a, p) => a + p.score, 0);
  console.log('   Scores quiz :', quizEnd.players.map((p) => `${p.name}=${p.score}`).join(', '));
  assert(quizEnd.players.every((p) => p.score >= 0) && total >= 0, 'Quiz : scores cohérents');
  host.removeAllListeners('state');
  players.forEach((p) => p.s.removeAllListeners('state'));

  /* ------------------------------------------------------------- MYTHO */
  let truthCheck = false;
  let revealSeen = 0;
  for (const p of players) {
    p.s.on('state', (v) => {
      const pv = v as PlayerView;
      const g = pv.game;
      if (g?.gameId !== 'mytho') return;
      if (g.step === 'write' && !g.hasSubmitted) {
        if (p.name === 'Alice' && !truthCheck && !g.error) {
          // Alice tente d'écrire la vérité : doit être refusé. On la récupère via un mot-clé connu.
          p.s.emit('game:action', { type: 'lie', text: '   ' });
          return;
        }
        if (g.error && p.name === 'Alice') truthCheck = true;
        p.s.emit('game:action', { type: 'lie', text: `mensonge de ${p.name} r${g.round}` });
      }
      if (g.step === 'vote' && !g.myVote && g.options?.length) {
        assert(!g.options.some((o) => o.text.includes(p.name)), `${p.name} ne voit pas son propre mensonge`);
        p.s.emit('game:action', { type: 'vote', optionId: g.options[0]!.id });
      }
    });
  }
  host.on('state', (v) => {
    const hv = v as HostView;
    const g = hv.game;
    if (g?.gameId !== 'mytho') return;
    if (g.step === 'intro') host.emit('room:control', { type: 'next' });
    if (g.step === 'reveal' && g.round > revealSeen) {
      revealSeen = g.round;
      const truth = g.reveal?.filter((r) => r.isTruth) ?? [];
      assert(truth.length === 1, `Manche ${g.round} : une seule vérité, ${g.reveal?.length} propositions`);
      assert(g.reveal!.length >= 4, `Manche ${g.round} : au moins 4 propositions (mensonges maison ajoutés si besoin)`);
      setTimeout(() => host.emit('room:control', { type: 'next' }), 50);
    }
  });

  host.emit('room:control', { type: 'start', gameId: 'mytho' });
  const mythoEnd = await waitFor<HostView>(host, (v) => v.phase === 'podium', 'fin du mytho');
  assert(revealSeen === 3, 'Mytho : 3 manches jouées');
  assert(truthCheck, 'Mytho : un mensonge vide est refusé avec un message');
  console.log('   Scores mytho :', mythoEnd.players.map((p) => `${p.name}=${p.score}`).join(', '));

  /* ------------------------------------------------------ Reconnexion */
  const bob = players[1]!;
  bob.s.close();
  await waitFor<HostView>(host, (v) => v.players.find((p) => p.id === bob.id)?.connected === false, 'Bob déconnecté');
  const bob2 = await connectSocket();
  const rejoin = await new Promise<{ ok: boolean; playerId?: string }>((r) =>
    bob2.emit('player:join', { code, name: 'Bob', token: bob.token }, (res) => r(res as never)),
  );
  assert(rejoin.ok && rejoin.playerId === bob.id, 'Bob se reconnecte avec son jeton et garde son identité');

  host.emit('room:control', { type: 'lobby' });
  await waitFor<HostView>(host, (v) => v.phase === 'lobby', 'retour salon');
  assert(true, 'Retour au salon');

  console.log('\n🎉 Simulation réussie !');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
