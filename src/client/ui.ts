import type { PlayerPublic } from '../shared/protocol';

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Décalage entre l'horloge serveur et l'horloge locale. */
let clockOffset = 0;
export function syncClock(serverNow: number): void {
  const offset = Date.now() - serverNow;
  // On ignore les micro-variations pour ne pas re-rendre la vue à chaque message.
  if (Math.abs(offset - clockOffset) > 300) clockOffset = offset;
}

/** Compte à rebours mis à jour en continu sans re-rendre la vue. */
export function countdown(endsAt: number, totalMs: number): string {
  const local = endsAt + clockOffset;
  return `<div class="timer" data-ends="${local}" data-total="${totalMs}">
    <div class="timer-bar"><div class="timer-fill"></div></div>
    <span class="timer-num"></span>
  </div>`;
}

function tickTimers(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-ends]').forEach((el) => {
    const ends = Number(el.dataset.ends);
    const total = Number(el.dataset.total) || 1;
    const left = Math.max(0, ends - now);
    const num = el.querySelector<HTMLElement>('.timer-num');
    const fill = el.querySelector<HTMLElement>('.timer-fill');
    if (num) num.textContent = String(Math.ceil(left / 1000));
    if (fill) fill.style.transform = `scaleX(${Math.min(1, left / total)})`;
    el.classList.toggle('urgent', left > 0 && left <= 5000);
  });
}
setInterval(tickTimers, 100);

/**
 * Met à jour le DOM par "morphing" : seuls les nœuds qui changent sont touchés.
 * Résultat : les animations ne redémarrent pas, la saisie et le focus des champs sont conservés.
 * Un attribut data-key différent force le remplacement (et donc l'animation d'entrée).
 */
export function render(root: HTMLElement, html: string): void {
  if (renderedHtml.get(root) === html) return;
  renderedHtml.set(root, html);
  const next = document.createElement('div');
  next.innerHTML = html;
  morphChildren(root, next);
  tickTimers();
}

const renderedHtml = new WeakMap<HTMLElement, string>();

function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (!(a instanceof Element) || !(b instanceof Element)) return true;
  return a.tagName === b.tagName && a.getAttribute('data-key') === b.getAttribute('data-key');
}

function morphNode(from: Node, to: Node): void {
  if (!(from instanceof Element) || !(to instanceof Element)) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of [...from.attributes]) {
    // Le style des minuteurs est piloté par tickTimers, on ne l'écrase pas.
    if (!to.hasAttribute(name) && !(name === 'style' && from.classList.contains('timer-fill'))) from.removeAttribute(name);
  }
  for (const { name, value } of [...to.attributes]) {
    if (from.getAttribute(name) !== value) {
      from.setAttribute(name, value);
      if (name === 'value' && from instanceof HTMLInputElement && document.activeElement !== from) {
        from.value = value;
      }
    }
  }
  if (from instanceof HTMLButtonElement && to instanceof HTMLButtonElement) from.disabled = to.disabled;
  morphChildren(from, to);
}

function morphChildren(from: Node, to: Node): void {
  const oldKids = [...from.childNodes];
  const newKids = [...to.childNodes];
  newKids.forEach((n, i) => {
    const o = oldKids[i];
    if (!o) from.appendChild(n);
    else if (sameNode(o, n)) morphNode(o, n);
    else from.replaceChild(n, o);
  });
  for (let i = newKids.length; i < oldKids.length; i++) from.removeChild(oldKids[i]!);
}

export function avatar(p: PlayerPublic | undefined, size: 'sm' | 'md' | 'lg' | 'xl' = 'md', extra = ''): string {
  if (!p) return '';
  return `<span class="avatar avatar-${size} ${p.connected ? '' : 'offline'} ${extra}" style="--c:${esc(p.color)}" title="${esc(p.name)}">${p.avatar}</span>`;
}

export function chip(p: PlayerPublic | undefined, extra = ''): string {
  if (!p) return '';
  return `<span class="chip" style="--c:${esc(p.color)}">${p.avatar} ${esc(p.name)}${extra}</span>`;
}

export const SHAPES = ['▲', '◆', '●', '■'];

export function formatPrompt(prompt: string): string {
  return esc(prompt).replace('___', '<span class="blank">______</span>');
}

export function rankedPlayers(players: PlayerPublic[]): PlayerPublic[] {
  return [...players].sort((a, b) => b.score - a.score);
}

export function vibrate(ms = 40): void {
  navigator.vibrate?.(ms);
}

/** Empêche la mise en veille de l'écran pendant une partie (mobile & TV). */
export function requestWakeLock(): void {
  try {
    void navigator.wakeLock?.request('screen').catch(() => {});
  } catch {
    // Non supporté sur certains navigateurs : ignoré silencieusement.
  }
}
