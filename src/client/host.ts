import type {
  ControlAction,
  HostView,
  MythoHostView,
  PlayerPublic,
  QuizHostView,
} from '../shared/protocol';
import { LIMITS } from '../shared/protocol';
import { connect } from './net';
import { sfx, toggleMute, unlockAudio } from './sfx';
import { SHAPES, avatar, chip, countdown, esc, formatPrompt, rankedPlayers, render, requestWakeLock, syncClock } from './ui';

const SESSION_KEY = 'zinzin:host';

export function startHost(root: HTMLElement): void {
  const socket = connect();
  let view: HostView | null = null;
  let joinBase = location.origin;
  let muted = false;
  let lastKey = '';
  let lastPlayerCount = 0;

  void fetch('/api/info')
    .then((r) => r.json())
    .then((info: { publicUrl: string | null; lanIps: string[] }) => {
      if (info.publicUrl) joinBase = info.publicUrl.replace(/\/$/, '');
      else if (['localhost', '127.0.0.1'].includes(location.hostname) && info.lanIps[0]) {
        joinBase = `${location.protocol}//${info.lanIps[0]}${location.port ? `:${location.port}` : ''}`;
      }
      draw();
    })
    .catch(() => {});

  const control = (action: ControlAction) => socket.emit('room:control', action);

  function create(): void {
    unlockAudio();
    requestWakeLock();
    socket.emit('host:create', (res) => {
      if (!res.ok) return;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: res.code, hostToken: res.hostToken }));
    });
  }

  function resume(): void {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return draw();
    socket.emit('host:resume', JSON.parse(saved), (res) => {
      if (!res.ok) {
        sessionStorage.removeItem(SESSION_KEY);
        view = null;
        draw();
      }
    });
  }

  socket.on('connect', resume);
  socket.on('state', (v) => {
    if (v.role !== 'host') return;
    syncClock(v.serverNow);
    view = v;
    localStorage.setItem('zinzin:demoCode', v.code);
    new BroadcastChannel('zinzin:demo').postMessage(v.code);
    playSounds(v);
    draw();
  });
  socket.on('closed', (reason) => {
    sessionStorage.removeItem(SESSION_KEY);
    view = null;
    render(root, `<div class="host splash"><h1 class="logo">Zinzin<span>Party</span></h1><p>${esc(reason)}</p>
      <button class="btn btn-xl" data-action="create">Nouvelle partie</button></div>`);
  });

  root.addEventListener('click', (e) => {
    unlockAudio();
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const [action, arg] = target.dataset.action!.split(':');
    if (action === 'create') create();
    else if (action === 'start') control({ type: 'start', gameId: arg as HostView['games'][number]['id'] });
    else if (action === 'category' && arg) control({ type: 'category', categoryId: arg as HostView['selectedCategory'] });
    else if (action === 'next') control({ type: 'next' });
    else if (action === 'lobby') control({ type: 'lobby' });
    else if (action === 'add-bot') control({ type: 'add-bot' });
    else if (action === 'kick' && arg) control({ type: 'kick', playerId: arg });
    else if (action === 'mute') {
      muted = toggleMute();
      draw();
    } else if (action === 'fullscreen') {
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
      else void document.exitFullscreen().catch(() => {});
    }
  });

  function playSounds(v: HostView): void {
    const g = v.game;
    const key = `${v.phase}|${g?.gameId}|${g?.step}|${g && 'index' in g ? g.index : g?.round}`;
    if (key !== lastKey) {
      if (v.phase === 'podium') sfx.fanfare();
      else if (g?.step === 'question' || g?.step === 'write' || g?.step === 'vote') sfx.question();
      else if (g?.step === 'reveal') sfx.reveal();
      lastKey = key;
    }
    if (v.players.length > lastPlayerCount) sfx.join();
    lastPlayerCount = v.players.length;
  }

  function draw(): void {
    if (!view) {
      render(
        root,
        `<div class="host splash">
          <h1 class="logo big">Zinzin<span>Party</span></h1>
          <p class="subtitle">L'écran de la télé, c'est ici. Les manettes, ce sont vos téléphones.</p>
          <button class="btn btn-xl" data-action="create">🎉 Créer une partie</button>
        </div>`,
      );
      return;
    }
    const v = view;
    let body: string;
    if (v.phase === 'lobby') body = lobby(v);
    else if (v.phase === 'podium') body = podium(v);
    else if (v.game?.gameId === 'quiz') body = quiz(v, v.game);
    else if (v.game?.gameId === 'mytho') body = mytho(v, v.game);
    else body = '';

    const g = v.game;
    const screenKey =
      v.phase !== 'game' || !g
        ? v.phase
        : g.gameId === 'quiz'
          ? `quiz-${g.step === 'intro' ? 'intro' : g.index}`
          : `mytho-${g.round}-${g.step}`;
    const controls =
      v.phase === 'game'
        ? `<button class="btn btn-ghost" data-action="next">⏭ Suivant</button>
           <button class="btn btn-ghost" data-action="lobby">✖ Arrêter</button>`
        : '';
    render(
      root,
      `<div class="host">
        <header class="host-head">
          <div class="logo">Zinzin<span>Party</span></div>
          <div class="head-right">
            ${v.phase !== 'lobby' ? `<span class="mini-code">Code <b>${esc(v.code)}</b></span>` : ''}
            ${controls}
            <button class="btn btn-ghost" data-action="fullscreen" title="Plein écran">⛶</button>
            <button class="btn btn-ghost" data-action="mute">${muted ? '🔇' : '🔊'}</button>
          </div>
        </header>
        <main class="host-main"><div class="screen" data-key="${screenKey}">${body}</div></main>
      </div>`,
    );
  }

  /* ---------------------------------------------------------------- Salon */

  function lobby(v: HostView): string {
    const joinUrl = `${joinBase}/?code=${v.code}`;
    const connected = v.players.filter((p) => p.connected).length;
    const players = v.players.length
      ? v.players
          .map(
            (p) => `<div class="lobby-player pop">
              ${avatar(p, 'lg')}
              <span class="name">${p.id === v.vipId ? '👑 ' : ''}${esc(p.name)}</span>
              <button class="kick" data-action="kick:${p.id}" title="Exclure">×</button>
            </div>`,
          )
          .join('')
      : `<p class="waiting">En attente des joueurs<span class="dots"></span></p>`;

    const activeCat = v.categories.find((c) => c.id === v.selectedCategory) ?? v.categories[0];
    const categories = v.categories
      .map((c) => {
        const active = c.id === v.selectedCategory;
        return `<button class="cat-pill ${active ? 'active' : ''}" data-action="category:${c.id}" title="${esc(c.description)}">
          <span>${c.emoji} ${esc(c.name)}</span>
          <small>${c.quizCount} Q · ${c.mythoCount} M</small>
        </button>`;
      })
      .join('');

    const games = v.games
      .map((g) => {
        const ok = connected >= g.minPlayers;
        return `<button class="game-card" data-action="start:${g.id}" ${ok ? '' : 'disabled'}>
          <span class="game-emoji">${g.emoji}</span>
          <span class="game-name">${esc(g.name)}</span>
          <span class="game-tag">${esc(g.tagline)}</span>
          <span class="game-cta">${ok ? 'Lancer ▶' : `${g.minPlayers} joueurs minimum`}</span>
        </button>`;
      })
      .join('');

    return `<div class="lobby">
      <section class="join-card">
        <p class="join-title">Scanne pour jouer</p>
        <img class="qr" src="/api/qr?text=${encodeURIComponent(joinUrl)}" alt="QR code" />
        <p class="join-url">${esc(joinUrl.replace(/^https?:\/\//, '').replace(/\/\?code=.*/, ''))}</p>
        <p class="join-title small">puis entre le code</p>
        <div class="code">${[...v.code].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</div>
      </section>
      <section class="lobby-right">
        <div class="panel">
          <div class="panel-head">
            <h2>Joueurs <small>${v.players.length}/${LIMITS.maxPlayers}</small></h2>
            ${
              v.players.length < LIMITS.maxPlayers
                ? `<button class="btn btn-ghost" data-action="add-bot">🤖 + Bot</button>`
                : ''
            }
          </div>
          <div class="player-grid">${players}</div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h2>Thématique <small>${activeCat ? `${activeCat.emoji} ${esc(activeCat.description)}` : ''}</small></h2>
          </div>
          <div class="cat-grid">${categories}</div>
          <h2 class="sub-head">Choisis un jeu</h2>
          <div class="game-grid">${games}</div>
          <p class="hint">👑 Le premier joueur arrivé peut aussi choisir la catégorie et lancer depuis son téléphone.</p>
        </div>
      </section>
    </div>`;
  }

  /* ----------------------------------------------------------------- Quiz */

  function quiz(v: HostView, g: QuizHostView): string {
    if (g.step === 'intro') {
      return intro('⚡', 'Quiz Express', [
        `${g.total} questions de culture G.`,
        'Réponds sur ton téléphone : plus tu es rapide, plus tu gagnes de points.',
        'Enchaîne les bonnes réponses pour un bonus de série 🔥',
      ], g.endsAt, 4000);
    }
    const byId = playersById(v.players);
    const reveal = g.step === 'reveal';
    const tiles = (g.choices ?? [])
      .map((c, i) => {
        const state = reveal ? (i === g.correctIndex ? 'correct' : 'wrong') : '';
        const count = reveal && g.counts ? `<span class="count">${g.counts[i]}</span>` : '';
        return `<div class="tile tile-${i} ${state}"><span class="shape">${SHAPES[i]}</span><span class="tile-text">${esc(c)}</span>${count}</div>`;
      })
      .join('');

    const footer = reveal
      ? `<div class="gains">${(g.gains ?? [])
          .map((x) => {
            const p = byId.get(x.playerId);
            if (!p) return '';
            return `<div class="gain ${x.correct ? 'good' : 'bad'}">${chip(p)}<b>${x.correct ? `+${x.points}` : '✗'}</b>${x.streak >= 2 ? `<span class="streak">🔥${x.streak}</span>` : ''}</div>`;
          })
          .join('')}</div>`
      : answeredBar(v, g.answeredIds, 'ont répondu');

    const stars = g.difficulty ? '★'.repeat(g.difficulty) : '';
    return `<div class="game-screen">
      <div class="game-top">
        <span class="badge">Question ${g.index + 1}/${g.total}</span>
        ${g.categoryName ? `<span class="badge badge-cat">${g.categoryEmoji ?? ''} ${esc(g.categoryName)} <small>${stars}</small></span>` : ''}
        ${countdown(g.endsAt, reveal ? 8000 : 20000)}
      </div>
      <h2 class="question">${esc(g.question)}</h2>
      <div class="tiles ${reveal ? 'revealed' : ''}">${tiles}</div>
      ${reveal && g.fact ? `<div class="fact-box pop">💡 <b>Le savais-tu ?</b> ${esc(g.fact)}</div>` : ''}
      ${footer}
      ${reveal ? leaderboard(v.players) : ''}
    </div>`;
  }

  /* ---------------------------------------------------------------- Mytho */

  function mytho(v: HostView, g: MythoHostView): string {
    if (g.step === 'intro') {
      return intro('🤥', 'Le Mytho', [
        'Une anecdote <b>vraie</b> s’affiche, avec un mot manquant.',
        'Sur ton téléphone, invente une <b>fausse réponse</b> crédible.',
        'Ensuite, trouve la <b>vérité</b> parmi tous les mensonges.',
        '+1000 si tu trouves la vérité · +500 par joueur piégé · dernière manche ×2 !',
      ], g.endsAt, 8000);
    }
    const byId = playersById(v.players);
    const top = `<div class="game-top">
      <span class="badge">Manche ${g.round}/${g.totalRounds}${g.multiplier > 1 ? ' <b class="x2">×2</b>' : ''}</span>
      ${g.categoryName ? `<span class="badge badge-cat">${g.categoryEmoji ?? ''} ${esc(g.categoryName)}</span>` : ''}
      ${countdown(g.endsAt, g.step === 'write' ? 60000 : g.step === 'vote' ? 30000 : 14000)}
    </div>
    <div class="prompt-card">${formatPrompt(g.prompt ?? '')}</div>`;

    if (g.step === 'write') {
      return `<div class="game-screen">${top}
        <p class="instruction">📱 Invente un mensonge crédible sur ton téléphone…</p>
        ${answeredBar(v, g.submittedIds, 'ont menti')}
      </div>`;
    }
    if (g.step === 'vote') {
      const opts = (g.options ?? []).map((o, i) => `<div class="option pop" style="--i:${i}">${esc(o.text)}</div>`).join('');
      return `<div class="game-screen">${top}
        <p class="instruction">🔎 Laquelle est la vérité ? Votez sur vos téléphones !</p>
        <div class="options">${opts}</div>
        ${answeredBar(v, g.votedIds, 'ont voté')}
      </div>`;
    }

    const items = (g.reveal ?? [])
      .map((item, i) => {
        const label = item.isTruth
          ? '<span class="label truth">✅ LA VÉRITÉ</span>'
          : item.authorIds.length
            ? `<span class="label lie">🤥 Mensonge de ${item.authorIds.map((id) => chip(byId.get(id))).join(' ')}</span>`
            : '<span class="label house">🏠 Mensonge de la maison</span>';
        const voters = item.voterIds.map((id) => avatar(byId.get(id), 'sm')).join('');
        return `<div class="reveal-item ${item.isTruth ? 'is-truth' : ''}" style="--i:${i}">
          <div class="reveal-text">${esc(item.text)}</div>
          ${label}
          <div class="voters">${voters || '<span class="nobody">personne</span>'}</div>
        </div>`;
      })
      .join('');
    const gains = Object.entries(g.gains ?? {})
      .filter(([, pts]) => pts > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => `<div class="gain good">${chip(byId.get(id))}<b>+${pts}</b></div>`)
      .join('');

    return `<div class="game-screen">${top}
      <div class="reveal-list">${items}</div>
      ${g.fact ? `<div class="fact-box pop">💡 <b>Le savais-tu ?</b> ${esc(g.fact)}</div>` : ''}
      <div class="gains">${gains}</div>
      ${leaderboard(v.players)}
    </div>`;
  }

  /* --------------------------------------------------------------- Podium */

  function podium(v: HostView): string {
    const ranked = rankedPlayers(v.players);
    const [first, second, third] = ranked;
    const step = (p: PlayerPublic | undefined, place: number) =>
      p
        ? `<div class="podium-step place-${place}">
            ${avatar(p, 'lg', 'bounce')}
            <div class="podium-name">${esc(p.name)}</div>
            <div class="podium-score">${p.score} pts</div>
            <div class="podium-block">${['🥇', '🥈', '🥉'][place - 1]}</div>
          </div>`
        : '<div class="podium-step empty"></div>';
    const rest = ranked
      .slice(3)
      .map((p, i) => `<li><span>#${i + 4}</span>${chip(p)}<b>${p.score}</b></li>`)
      .join('');
    const lastGame = v.games.find((g) => g.id === v.lastGameId);
    return `<div class="podium-screen">
      ${confetti()}
      <h2 class="podium-title">🏆 ${esc(first?.name ?? '')} remporte la partie !</h2>
      <div class="podium">${step(second, 2)}${step(first, 1)}${step(third, 3)}</div>
      ${rest ? `<ol class="rest">${rest}</ol>` : ''}
      <div class="podium-actions">
        ${lastGame ? `<button class="btn btn-xl" data-action="start:${lastGame.id}">🔁 Rejouer à ${esc(lastGame.name)}</button>` : ''}
        <button class="btn btn-xl btn-alt" data-action="lobby">🏠 Retour au salon</button>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- Helpers */

  function intro(emoji: string, title: string, lines: string[], endsAt: number, total: number): string {
    return `<div class="intro">
      <div class="intro-emoji">${emoji}</div>
      <h2 class="intro-title">${title}</h2>
      <ul class="rules">${lines.map((l, i) => `<li style="--i:${i}">${l}</li>`).join('')}</ul>
      ${countdown(endsAt, total)}
    </div>`;
  }

  function answeredBar(v: HostView, doneIds: string[], label: string): string {
    const done = new Set(doneIds);
    const active = v.players.filter((p) => p.connected);
    const count = active.filter((p) => done.has(p.id)).length;
    return `<div class="answered">
      <div class="answered-avatars">${active.map((p) => avatar(p, 'md', done.has(p.id) ? 'done' : 'pending')).join('')}</div>
      <span>${count}/${active.length} ${label}</span>
    </div>`;
  }

  function leaderboard(players: PlayerPublic[]): string {
    const top = rankedPlayers(players).slice(0, 5);
    return `<ol class="leaderboard">${top
      .map((p, i) => `<li style="--i:${i}"><span class="rank">${i + 1}</span>${chip(p)}<b>${p.score}</b></li>`)
      .join('')}</ol>`;
  }
}

function playersById(players: PlayerPublic[]): Map<string, PlayerPublic> {
  return new Map(players.map((p) => [p.id, p]));
}

/** Confettis déterministes (pas de hasard, sinon le HTML changerait à chaque rendu). */
function confetti(): string {
  const colors = ['#ff4d6d', '#ffb703', '#06d6a0', '#4cc9f0', '#b388ff', '#f72585'];
  return `<div class="confetti">${Array.from({ length: 60 }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = ((i * 53) % 40) / 10;
    const dur = 3 + ((i * 17) % 30) / 10;
    return `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s"></i>`;
  }).join('')}</div>`;
}
