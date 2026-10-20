import { startHost } from './host';
import { startPlayer } from './player';
import './style.css';

const root = document.getElementById('app')!;

if (location.pathname.startsWith('/demo')) {
  document.body.classList.add('is-demo');
  root.innerHTML = `
    <div class="demo-layout">
      <div class="demo-tv">
        <div class="demo-bar">📺 Écran TV (Hôte) — <a href="/host">Plein écran</a> · <a href="/">Vue joueur</a></div>
        <iframe src="/host" title="Écran TV"></iframe>
      </div>
      <div class="demo-phones">
        <div class="demo-phone">
          <div class="demo-bar">📱 Téléphone 1 (Alice)</div>
          <iframe src="/?slot=1&name=Alice" title="Téléphone 1"></iframe>
        </div>
        <div class="demo-phone">
          <div class="demo-bar">📱 Téléphone 2 (Bob)</div>
          <iframe src="/?slot=2&name=Bob" title="Téléphone 2"></iframe>
        </div>
      </div>
    </div>
  `;
} else if (location.pathname.startsWith('/host')) {
  document.body.classList.add('is-host');
  startHost(root);
} else {
  document.body.classList.add('is-player');
  startPlayer(root);
}
