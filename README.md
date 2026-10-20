# 🎉 Zinzin Party

Plateforme de **party-game multijoueur temps réel** façon *Jackbox / Kahoot* pensée **Production-First** :
- **L'écran principal (`/host`)** s'affiche sur la TV, un PC ou un vidéoprojecteur avec un QR code dynamique et un code à 4 lettres.
- **Les téléphones (`/`)** servent de manettes instantanées via le navigateur mobile (zéro installation, PWA installable, reconnexion automatique, Screen Wake Lock, vibrations, effets sonores Web Audio).
- **Mode Studio / Démo (`/demo`)** permet de tester sur un seul écran l'écran TV + 2 téléphones côte à côte, avec ajout de **bots autonomes** en un clic.

---

## 🌍 8 Catégories & Banque de Questions Vérifiées

| Catégorie | Contenu | Quiz | Mytho |
|---|---|---:|---:|
| 🌍 **100 % Afrique (Mix)** *(par défaut)* | Toutes les thématiques africaines réunies | **104** | **38** |
| 🎲 **Grand Mix (Tout)** | Toutes les catégories mélangées (Afrique + Monde) | **120** | **46** |
| 👑 **Afrique : Histoire & Géo** | Empires du Mali, Songhaï, Kouch, Grand Zimbabwe, Mansa Moussa, Soundiata Keïta, Thomas Sankara, reine Nzinga, Amazones du Dahomey, Cheikh Anta Diop, capitales, fleuves, langues | **24** | **8** |
| 🎶 **Musique & Pop Culture Afro** | Afrobeats, Rumba congolaise, Coupé-décalé, Zouglou, Amapiano, Makossa, Fela Kuti, Burna Boy, Rema, Magic System, Papa Wemba, Manu Dibango, Angélique Kidjo, FESPACO, Nollywood, Wakaliwood | **22** | **7** |
| 🍲 **Cuisine & Traditions** | Thiéboudienne, Attiéké & Garba, Jollof Rice, Ndolé, Poulet DG, Mafé, Alloco, Injera, Pondu, Kédjénou, Bissap, Bouye, Kola, Kente, Bogolan, Awalé, Cauris | **20** | **7** |
| ⚽ **Sport & Légendes Africaines** | CAN, George Weah, Samuel Eto'o, Didier Drogba, Sadio Mané, Roger Milla, Jay-Jay Okocha, épopées du Sénégal 2002 / Maroc 2022 / Côte d'Ivoire 2024, Abebe Bikila, Eliud Kipchoge, Francis Ngannou, Joel Embiid, Hakeem Olajuwon | **20** | **6** |
| 🦁 **Sciences, Faune & Nature** | Okapi, baobab, guépard, pangolin, parc des Virunga, lac Rose, lac Natron, Toumaï (Tchad), Lucy (Éthiopie), os d'Ishango, réacteur naturel d'Oklo (Gabon), Dr Denis Mukwege, Pr Jean-Jacques Muyembe, Cheick Modibo Diarra | **18** | **10** |
| 🌐 **Monde & Insolite** | Culture générale mondiale, inventions, records historiques et anecdotes insolites | **16** | **8** |

---

## 🚀 Démarrage rapide (Local)

```bash
npm install

# Mode développement (serveur temps réel + Vite HMR)
npm run dev

# Build & lancement en production
npm run build
npm start

# Simulation automatisée de bout en bout (Hôte + 3 joueurs sur Quiz + Mytho)
npm run simulate
```

### URLs locales
- **Mode Studio / Démo (TV + 2 téléphones)** : `http://localhost:3000/demo`
- **Écran TV / Hôte** : `http://localhost:3000/host`
- **Manette joueur (mobile)** : `http://localhost:3000/`

---

## ☁️ Déploiement Production pour Utilisateurs Réels

Le projet est conçu pour être déployé en **un seul service** (le serveur Node.js sert à la fois le front compilé `dist/client` avec cache long terme et le serveur WebSocket Socket.IO, et détecte automatiquement son domaine public derrière un reverse-proxy HTTPS).

### Option 1 : Render.com (Gratuit / 1 clic)
Un fichier [`render.yaml`](render.yaml) est inclus :
1. Sur [Render](https://dashboard.render.com/), cliquer sur **New + → Blueprint** (ou **Web Service**) et sélectionner ce dépôt GitHub (`xtedBenoit/zinzin-party`).
2. Render détecte automatiquement `npm ci && npm run build` et `npm start` avec healthcheck sur `/api/health`.
3. Dès que l'URL `https://zinzin-party.onrender.com` est en ligne, ouvrir `/host` sur la TV et scanner le QR code avec n'importe quel téléphone (4G/5G ou Wi-Fi) !

### Option 2 : Railway.app
Un fichier [`railway.json`](railway.json) est inclus :
1. Sur [Railway](https://railway.app/), faire **New Project → Deploy from GitHub repo** et choisir `xtedBenoit/zinzin-party`.
2. Générer un domaine public dans *Settings → Networking*.

### Option 3 : Docker / VPS
Un [`Dockerfile`](Dockerfile) multi-stage Alpine non-root est inclus :
```bash
docker build -t zinzin-party .
docker run -d -p 3000:3000 --name zinzin-party zinzin-party
```

---

## 🛡️ Architecture Production-First

- **Sécurité & Anti-abus** ([`src/server/index.ts`](src/server/index.ts)) : `trust proxy`, en-têtes HTTP de sécurité, rate-limiting par IP sur la création de salons, rate-limiting par socket WebSocket, limite de taille des paquets (`16 Ko`), validation stricte des payloads, cache LRU des QR codes SVG, et arrêt gracieux (`SIGTERM`/`SIGINT`).
- **Gestion mémoire & cycle de vie** ([`src/server/rooms.ts`](src/server/rooms.ts)) : nettoyage automatique des salons abandonnés (15 min) ou inactifs (2 h), plafond de salles simultanées, reconnexion transparente par jeton de session.
- **Stabilité des questions** ([`src/server/games/content/categories.ts`](src/server/games/content/categories.ts)) : anti-répétition par salon (`usedItemIds`), progression de difficulté (`★` → `★★` → `★★★`), alternance des sous-catégories et encadré *« 💡 Le savais-tu ? »* à chaque révélation.
