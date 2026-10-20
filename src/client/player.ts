import type { GameAction, MythoPlayerView, PlayerPublic, PlayerView, QuizPlayerView } from '../shared/protocol';
import { LIMITS } from '../shared/protocol';
import { connect } from './net';
import { SHAPES, avatar, countdown, esc, formatPrompt, rankedPlayers, render, requestWakeLock, syncClock, vibrate } from './ui';

const STORAGE_KEY = 'zinzin:player';

interface Saved {
  code: string;
  token?: string;
  name: string;
}

function loadSaved(key: string): Saved | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function saveSession(key: string, s: Saved | null): void {
  if (!s) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, JSON.stringify(s));
}

export function startPlayer(root: HTMLElement): void {
  const socket = connect();
  const params = new URLSearchParams(location.search);
  const slot = params.get('slot') ?? '';
  const defaultName = params.get('name') ?? '';
  const storageKey = slot ? `${STORAGE_KEY}:${slot}` : STORAGE_KEY;
  const urlCode = params.get('code')?.toUpperCase() ?? '';
  let saved = loadSaved(storageKey);
  let view: PlayerView | null = null;
  let joined = false;
  let joining = false;
  let error = '';
  let lastKey = '';

  if (slot) {
    const refresh = () => {
      if (!joined && !view) drawJoin();
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'zinzin:demoCode') refresh();
    });
    new BroadcastChannel('zinzin:demo').onmessage = refresh;
  }

  // Rejoin automatique si on revient sur la même partie (rechargement, écran verrouillé…).
  const autoRejoin = saved?.token && (!urlCode || urlCode === saved.code);

  function join(code: string, name: string, token?: string): void {
    joining = true;
    socket.emit('player:join', { code, name, token }, (res) => {
      joining = false;
      if (!res.ok) {
        joined = false;
        error = res.error;
        if (token && saved) {
          // Ancienne partie terminée : on garde seulement le pseudo.
          saved = { code: urlCode, name: saved.name };
          saveSession(storageKey, saved);
          error = '';
        }
        drawJoin();
        return;
      }
      joined = true;
      error = '';
      requestWakeLock();
      saved = { code: code.toUpperCase(), name, token: res.token };
      saveSession(storageKey, saved);
      history.replaceState(null, '', slot ? `/?slot=${encodeURIComponent(slot)}` : '/');
    });
  }

  socket.on('connect', () => {
    if (joined && saved?.token) join(saved.code, saved.name, saved.token);
    else if (autoRejoin && saved && !view) join(saved.code, saved.name, saved.token);
  });

  socket.on('state', (v) => {
    if (v.role !== 'player') return;
    syncClock(v.serverNow);
    view = v;
    const g = v.game;
    const key = `${v.phase}|${g?.step}|${g && 'index' in g ? g.index : g?.round}`;
    if (key !== lastKey && (g?.step === 'question' || g?.step === 'write' || g?.step === 'vote')) vibrate(60);
    lastKey = key;
    draw();
  });

  const leave = (message: string) => {
    joined = false;
    view = null;
    if (saved) saved = { code: '', name: saved.name };
    saveSession(storageKey, saved);
    error = message;
    drawJoin();
  };
  socket.on('kicked', () => leave("Tu as été exclu de la partie par l'hôte."));
  socket.on('closed', (reason) => leave(reason));

  const act = (action: GameAction) => {
    vibrate(25);
    socket.emit('game:action', action);
  };

  root.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const [action, arg] = target.dataset.action!.split(':');
    switch (action) {
      case 'answer':
        act({ type: 'answer', index: Number(arg) });
        break;
      case 'vote':
        act({ type: 'vote', optionId: arg! });
        break;
      case 'start':
        socket.emit('room:control', { type: 'start', gameId: arg as 'quiz' | 'mytho' });
        break;
      case 'category':
        if (arg) socket.emit('room:control', { type: 'category', categoryId: arg as PlayerView['selectedCategory'] });
        break;
      case 'next':
        socket.emit('room:control', { type: 'next' });
        break;
      case 'lobby':
        socket.emit('room:control', { type: 'lobby' });
        break;
      case 'add-bot':
        socket.emit('room:control', { type: 'add-bot' });
        break;
    }
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    if (form.id === 'join-form') {
      const code = String(data.get('code') ?? '').toUpperCase().trim();
      const name = String(data.get('name') ?? '').trim();
      if (code.length !== LIMITS.codeLength) return showError('Le code fait 4 lettres.');
      if (!name) return showError('Choisis un pseudo !');
      join(code, name);
    } else if (form.id === 'lie-form') {
      const text = String(data.get('lie') ?? '').trim();
      if (text) act({ type: 'lie', text });
      const input = form.querySelector<HTMLInputElement>('input');
      if (input) input.value = '';
    }
  });

  function showError(message: string): void {
    error = message;
    drawJoin();
  }

  /* ---------------------------------------------------------- Rendu */

  function drawJoin(): void {
    const demoCode = slot ? (localStorage.getItem('zinzin:demoCode') ?? '') : '';
    const prefillCode = urlCode || saved?.code || demoCode;
    const prefillName = saved?.name || defaultName;
    render(
      root,
      `<div class="phone join-screen">
        <h1 class="logo big">Zinzin<span>Party</span></h1>
        <form id="join-form" class="join-form" autocomplete="off">
          <label>Code de la partie
            <input name="code" data-keep="code" maxlength="${LIMITS.codeLength}" autocapitalize="characters"
              placeholder="ABCD" value="${esc(prefillCode)}" class="code-input" />
          </label>
          <label>Ton pseudo
            <input name="name" data-keep="name" maxlength="${LIMITS.nameMax}" placeholder="Ex. Toto"
              value="${esc(prefillName)}" />
          </label>
          <button class="btn btn-xl" ${joining ? 'disabled' : ''}>C'est parti ! 🚀</button>
          <p class="error">${esc(error)}</p>
        </form>
        ${
          slot
            ? ''
            : `<div class="join-links">
                <a class="host-link" href="/host">📺 Héberger sur cet écran (TV)</a>
                <a class="host-link" href="/demo">🧪 Mode Démo (TV + 2 téléphones)</a>
              </div>`
        }
      </div>`,
    );
  }

  function draw(): void {
    if (!view) return drawJoin();
    const v = view;
    const me = v.players.find((p) => p.id === v.meId);
    if (!me) return drawJoin();
    const isVip = v.vipId === v.meId;

    let body: string;
    if (v.phase === 'lobby') body = lobby(v, isVip);
    else if (v.phase === 'podium') body = podium(v, me, isVip);
    else if (v.game?.gameId === 'quiz') body = quiz(v.game);
    else if (v.game?.gameId === 'mytho') body = mytho(v.game);
    else body = '';

    const g = v.game;
    const sub = !g ? '' : g.gameId === 'quiz' ? `${g.index}-${g.myAnswer !== null}` : `${g.round}-${g.hasSubmitted}-${!!g.myVote}`;
    const screenKey = `${v.phase}-${g?.gameId ?? ''}-${g?.step ?? ''}-${sub}-${isVip}`;
    const vipNext =
      isVip && v.phase === 'game' && (g?.step === 'intro' || g?.step === 'reveal')
        ? '<button class="btn btn-ghost vip-next" data-action="next">👑 Suivant ⏭</button>'
        : '';

    render(
      root,
      `<div class="phone" style="--me:${esc(me.color)}">
        <header class="phone-head">
          ${avatar(me, 'sm')}
          <span class="me-name">${isVip ? '👑 ' : ''}${esc(me.name)}</span>
          <span class="me-score">${me.score} pts</span>
        </header>
        <main class="phone-main"><div class="screen" data-key="${screenKey}">${body}</div></main>
        ${vipNext}
      </div>`,
    );
  }

  function lobby(v: PlayerView, isVip: boolean): string {
    const me = v.players.find((p) => p.id === v.meId)!;
    const vip = v.players.find((p) => p.id === v.vipId);
    const connected = v.players.filter((p) => p.connected).length;
    const activeCat = v.categories.find((c) => c.id === v.selectedCategory) ?? v.categories[0];
    const catPills = v.categories
      .map(
        (c) =>
          `<button class="cat-pill ${c.id === v.selectedCategory ? 'active' : ''}" data-action="category:${c.id}">
            <span>${c.emoji} ${esc(c.name)}</span>
          </button>`,
      )
      .join('');
    const vipBlock = isVip
      ? `<div class="vip-box">
          <p>👑 Thématique :</p>
          <div class="cat-grid phone-cats">${catPills}</div>
          <p>👑 Choisis le jeu :</p>
          ${v.games
            .map(
              (g) =>
                `<button class="btn btn-game" data-action="start:${g.id}" ${connected < g.minPlayers ? 'disabled' : ''}>
                  ${g.emoji} ${esc(g.name)}${connected < g.minPlayers ? ` <small>(${g.minPlayers} joueurs min.)</small>` : ''}
                </button>`,
            )
            .join('')}
          ${
            v.players.length < LIMITS.maxPlayers
              ? `<button class="btn btn-ghost" data-action="add-bot">🤖 Ajouter un bot</button>`
              : ''
          }
        </div>`
      : `<p class="waiting">Thème : <b>${activeCat ? `${activeCat.emoji} ${esc(activeCat.name)}` : ''}</b><br/>En attente que 👑 ${esc(vip?.name ?? "l'hôte")} lance une partie<span class="dots"></span></p>`;
    return `<div class="center">
      ${avatar(me, 'xl', 'bounce')}
      <h2>Tu es dans la partie !</h2>
      <p class="muted">${connected} joueur${connected > 1 ? 's' : ''} connecté${connected > 1 ? 's' : ''} · regarde l'écran 📺</p>
      ${vipBlock}
    </div>`;
  }

  function quiz(g: QuizPlayerView): string {
    if (g.step === 'intro') return waitScreen('⚡', 'Prépare-toi !', 'Les questions arrivent…');
    if (g.step === 'question') {
      if (g.myAnswer !== null) {
        return `<div class="center locked">
          <div class="big-shape tile-${g.myAnswer}">${SHAPES[g.myAnswer]}</div>
          <h2>Réponse verrouillée 🔒</h2>
          <p class="muted">Croise les doigts…</p>
        </div>`;
      }
      return `<div class="answer-screen">
        <div class="phone-top">
          <span class="badge">${g.index + 1}/${g.total}</span>
          ${g.categoryName ? `<span class="badge badge-cat">${g.categoryEmoji ?? ''} ${esc(g.categoryName)}</span>` : ''}
          ${countdown(g.endsAt, 20000)}
        </div>
        <p class="phone-question">${esc(g.question)}</p>
        <div class="answer-grid">${(g.choices ?? [])
          .map(
            (c, i) =>
              `<button class="answer tile-${i}" data-action="answer:${i}"><span class="shape">${SHAPES[i]}</span>${esc(c)}</button>`,
          )
          .join('')}</div>
      </div>`;
    }
    // reveal
    const gain = g.myGain;
    const factHtml = g.fact ? `<div class="fact-box small">💡 ${esc(g.fact)}</div>` : '';
    if (gain?.correct) {
      return `<div class="center result good">
        <div class="result-emoji">🎉</div>
        <h2>Bonne réponse !</h2>
        <p class="points">+${gain.points}</p>
        ${gain.streak >= 2 ? `<p class="streak">🔥 Série de ${gain.streak}</p>` : ''}
        ${factHtml}
      </div>`;
    }
    const correct = g.correctIndex !== null && g.choices ? g.choices[g.correctIndex] : '';
    return `<div class="center result bad">
      <div class="result-emoji">${g.myAnswer === null ? '⏰' : '😵'}</div>
      <h2>${g.myAnswer === null ? 'Trop tard !' : 'Raté !'}</h2>
      <p class="muted">La bonne réponse : <b>${esc(correct)}</b></p>
      ${factHtml}
    </div>`;
  }

  function mytho(g: MythoPlayerView): string {
    if (g.step === 'intro') return waitScreen('🤥', 'Le Mytho', 'Invente des mensonges crédibles et trouve la vérité !');
    const top = `<div class="phone-top"><span class="badge">Manche ${g.round}/${g.totalRounds}${g.multiplier > 1 ? ' ×2' : ''}</span>${
      g.step !== 'reveal' ? countdown(g.endsAt, g.step === 'write' ? 60000 : 30000) : ''
    }</div>`;

    if (g.step === 'write') {
      if (g.hasSubmitted) return waitScreen('🤫', 'Mensonge enregistré', 'On attend les autres menteurs…');
      return `<div class="write-screen">${top}
        <p class="phone-prompt">${formatPrompt(g.prompt ?? '')}</p>
        <form id="lie-form" class="lie-form" autocomplete="off">
          <input name="lie" data-keep="lie" maxlength="${LIMITS.lieMax}" placeholder="Ton mensonge…" autofocus />
          <button class="btn">Envoyer 🤥</button>
        </form>
        ${g.error ? `<p class="error">${esc(g.error)}</p>` : '<p class="muted">Sois crédible : le but est que les autres te croient !</p>'}
      </div>`;
    }

    if (g.step === 'vote') {
      if (g.myVote) return waitScreen('🗳️', 'Vote enregistré', 'Suspense…');
      return `<div class="vote-screen">${top}
        <p class="phone-prompt small">${formatPrompt(g.prompt ?? '')}</p>
        <p class="muted">Trouve la <b>vérité</b> :</p>
        <div class="vote-list">${(g.options ?? [])
          .map((o) => `<button class="btn btn-option" data-action="vote:${o.id}">${esc(o.text)}</button>`)
          .join('')}</div>
      </div>`;
    }

    const r = g.result;
    const lines: string[] = [];
    lines.push(r?.foundTruth ? '✅ Tu as trouvé la vérité !' : '😅 Tu t’es fait avoir…');
    if (r && r.fooled > 0) lines.push(`🤥 Tu as piégé ${r.fooled} joueur${r.fooled > 1 ? 's' : ''} !`);
    return `<div class="center result ${r && r.gained > 0 ? 'good' : 'bad'}">
      <p class="muted">La vérité : <b>${esc(g.truth)}</b></p>
      ${lines.map((l) => `<h3>${l}</h3>`).join('')}
      <p class="points">+${r?.gained ?? 0}</p>
      ${g.fact ? `<div class="fact-box small">💡 ${esc(g.fact)}</div>` : ''}
    </div>`;
  }

  function podium(v: PlayerView, me: PlayerPublic, isVip: boolean): string {
    const rank = rankedPlayers(v.players).findIndex((p) => p.id === me.id) + 1;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] ?? '🎈';
    const last = v.games.find((g) => g.id === v.lastGameId);
    return `<div class="center">
      <div class="result-emoji">${medal}</div>
      <h2>Tu finis #${rank} !</h2>
      <p class="points">${me.score} pts</p>
      ${
        isVip
          ? `<div class="vip-box">
              ${last ? `<button class="btn btn-game" data-action="start:${last.id}">🔁 Rejouer à ${esc(last.name)}</button>` : ''}
              <button class="btn btn-game btn-alt" data-action="lobby">🏠 Retour au salon</button>
            </div>`
          : '<p class="muted">Regarde le podium sur l’écran 📺</p>'
      }
    </div>`;
  }

  function waitScreen(emoji: string, title: string, subtitle: string): string {
    return `<div class="center"><div class="result-emoji wobble">${emoji}</div><h2>${title}</h2><p class="muted">${subtitle}</p></div>`;
  }

  if (!autoRejoin) drawJoin();
  else render(root, '<div class="phone center"><p class="muted">Reconnexion…</p></div>');
}
