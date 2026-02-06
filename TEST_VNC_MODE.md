# 🧪 Mode Test VNC - Guide de Debug

## 🎯 **Objectif**

Le **Mode Test VNC** permet de déboguer rapidement les problèmes de connexion VNC/websockify **sans avoir à lancer tout le processus de provisioning WhatsApp**.

### Pourquoi cette fonctionnalité ?

Le provisioning WhatsApp complet prend **2-3 minutes** et inclut :
- ✅ Création du conteneur Android
- ✅ Installation WhatsApp
- ✅ Achat d'un numéro (coût réel)
- ✅ Configuration du compte
- ✅ Injection OTP

**Problème** : Si le VNC ne fonctionne pas, on perd du temps et de l'argent à chaque test.

**Solution** : Le Mode Test VNC lance **UNIQUEMENT** :
- ✅ Conteneur Android (émulateur)
- ✅ Websockify (proxy VNC)
- ✅ Session minimale dans la DB

**Résultat** : Test en **30 secondes** au lieu de 3 minutes, sans coût.

---

## 📋 **Comment utiliser**

### 1️⃣ **Lancer un Test VNC**

1. Va sur **http://localhost:5173**
2. Connecte-toi avec tes identifiants
3. Dans la sidebar, clique sur le bouton bleu **"🧪 Test VNC (Debug Mode)"**

```
┌────────────────────────────┐
│  Search sessions...  [+New]│
│                            │
│  🧪 Test VNC (Debug Mode)  │  ← Clique ici
│                            │
│  🗑️ Delete All Sessions    │
└────────────────────────────┘
```

4. **Attends 30 secondes** pendant que le système :
   - Crée le conteneur Android
   - Lance websockify
   - Attend que VNC soit prêt (10 tentatives de 3 secondes)

5. **Une popup apparaît** :
```
✅ Test VNC container created!

Session ID: test-abc123

Navigate to "Stream" tab to see the Android emulator.
```

6. **Clique sur "Stream" dans le menu du haut** pour voir l'émulateur Android

---

### 2️⃣ **Vérifier que VNC fonctionne**

Si tout va bien, tu devrais voir :
- ✅ L'écran Android dans l'iframe
- ✅ Tu peux voir le launcher Android
- ✅ Pas de "502 Bad Gateway"

Si ça ne marche pas, tu verras :
- ❌ "502 Bad Gateway nginx/1.29.3"
- ❌ "Conteneur VNC inactif"

---

### 3️⃣ **Déboguer un problème**

#### **Étape 1 : Vérifier les conteneurs Docker**

```bash
# Liste tous les conteneurs de test
docker ps -a --filter "name=test-"

# Tu devrais voir 2 conteneurs :
# wa-emulator-test-XXXXXX (émulateur)
# websockify-test-XXXXXX (proxy VNC)
```

#### **Étape 2 : Vérifier les logs du conteneur émulateur**

```bash
# Remplace test-XXXXXX par ton ID de test
docker logs wa-emulator-test-XXXXXX --tail 50

# Cherche des erreurs comme :
# - "VNC server failed to start"
# - "x11vnc: error"
# - "XVFB failed"
```

#### **Étape 3 : Vérifier les logs websockify**

```bash
# Remplace test-XXXXXX par ton ID de test
docker logs websockify-test-XXXXXX --tail 50

# Tu devrais voir :
# "WebSocket server settings:"
# "listening on :8080"
```

#### **Étape 4 : Vérifier la route nginx**

```bash
# Dans le navigateur, ouvre la console développeur (F12)
# Va dans l'onglet "Network"
# Clique sur "Stream"
# Cherche la requête WebSocket qui échoue
```

#### **Étape 5 : Vérifier la résolution DNS**

```bash
# Entre dans le conteneur frontend
docker exec -it wa-frontend sh

# Essaie de résoudre le nom du conteneur websockify
ping websockify-test-XXXXXX

# Si "ping: bad address", c'est un problème DNS
```

---

### 4️⃣ **Nettoyer après les tests**

Les conteneurs de test restent actifs jusqu'à ce que tu les supprimes :

```bash
# Supprimer TOUS les conteneurs de test
docker ps -a --filter "name=test-" --format "{{.Names}}" | ForEach-Object { docker rm -f $_ }

# Ou un par un
docker rm -f wa-emulator-test-XXXXXX
docker rm -f websockify-test-XXXXXX
```

Tu peux aussi les supprimer via l'interface en cliquant sur "🗑️ Delete All Sessions".

---

## 🔧 **Architecture du Mode Test**

### Backend (API)

**Fichier** : `src/routes/test.routes.ts`

**Route** : `POST /test/vnc-container`

**Processus** :
1. Génère un ID de test : `test-{8 caractères aléatoires}`
2. Lance le conteneur Android avec `dockerService.spawnEmulator()`
3. Crée une session dans la DB avec `sessionService.createSession()`
4. **Attend que websockify soit prêt** (10 tentatives × 3 secondes = 30s max)
5. Retourne les infos du test (sessionId, streamUrl, vncPort, etc.)

**Avantage** : Pas de worker, pas de queue, pas de WhatsApp → **Instantané**

### Frontend

**Fichier** : `frontend/src/components/Sidebar.tsx`

**Bouton** : "🧪 Test VNC (Debug Mode)"

**Processus** :
1. Appelle `createTestVncContainer()` (API call)
2. Affiche un spinner pendant la création
3. Refresh les sessions pour afficher la nouvelle session de test
4. Sélectionne automatiquement la session de test
5. Affiche une popup de confirmation

**Fichier API** : `frontend/src/api/test.api.ts`

---

## 📊 **Comparaison : Provisioning vs Test VNC**

| Critère | Provisioning Complet | Mode Test VNC |
|---------|---------------------|---------------|
| **Temps** | 2-3 minutes | 30 secondes |
| **Coût** | ~$0.50 (numéro SMS) | $0 |
| **WhatsApp** | ✅ Installé et configuré | ❌ Pas installé |
| **Numéro** | ✅ Acheté | ❌ Pas de numéro |
| **VNC** | ✅ Fonctionnel | ✅ Fonctionnel |
| **Session DB** | ✅ Complète | ✅ Minimale |
| **Message polling** | ✅ Actif | ❌ Désactivé |
| **But** | Production | Debug uniquement |

---

## 🐛 **Problèmes courants et solutions**

### Problème 1 : "502 Bad Gateway" après création

**Symptôme** :
```
✅ Test VNC container created!
Session ID: test-abc123

[Mais dans Stream]
502 Bad Gateway nginx/1.29.3
```

**Cause** : Websockify n'a pas démarré ou a crashé

**Solution** :
```bash
# Vérifie si websockify existe
docker ps -a --filter "name=websockify-test-abc123"

# Si STATUS = "Exited", regarde les logs
docker logs websockify-test-abc123

# Si le conteneur n'existe pas, regarde les logs de l'API
docker logs wa-api --tail 50
```

---

### Problème 2 : Websockify démarre mais VNC ne répond pas

**Symptôme** :
```
✅ websockify container is running
❌ But the VNC stream shows a black screen or hangs
```

**Cause** : x11vnc (serveur VNC) n'a pas démarré dans l'émulateur

**Solution** :
```bash
# Entre dans le conteneur émulateur
docker exec -it wa-emulator-test-abc123 bash

# Vérifie si x11vnc tourne
ps aux | grep x11vnc

# Si absent, démarre-le manuellement
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 &
```

---

### Problème 3 : "VNC stream container is not active"

**Symptôme** :
```
Conteneur VNC inactif
Le conteneur VNC pour cette session n'est pas actif.
```

**Cause** : Le conteneur émulateur a été supprimé ou a crashé

**Solution** :
```bash
# Vérifie si le conteneur existe
docker ps -a --filter "name=wa-emulator-test-abc123"

# Si STATUS = "Exited", regarde pourquoi il a crashé
docker logs wa-emulator-test-abc123

# Raisons possibles :
# - Mémoire insuffisante (augmente Docker memory limit)
# - Image corrompue (docker pull budtmo/docker-android:latest)
# - Port déjà utilisé (change le port VNC)
```

---

### Problème 4 : Container créé mais websockify pas "ready"

**Symptôme** :
```
⏳ Websockify not ready yet, waiting 3 seconds... (attempt 10/10)
❌ VNC container started but websockify failed to become ready
```

**Cause** : Websockify prend plus de 30 secondes à démarrer

**Solution temporaire** :
1. Augmente `maxRetries` dans `src/routes/test.routes.ts` (ligne 47) :
```typescript
const maxRetries = 15; // Au lieu de 10 → 45 secondes au lieu de 30
```

2. Ou vérifie si websockify a vraiment démarré :
```bash
docker logs websockify-test-abc123

# Tu devrais voir :
# "WebSocket server settings:"
# "listening on :8080"
```

---

## 🎯 **Plan d'action pour déboguer VNC**

### Phase 1 : Valider que websockify démarre

1. Clique sur "🧪 Test VNC (Debug Mode)"
2. Attends la popup de confirmation
3. Vérifie que **2 conteneurs** ont été créés :
```bash
docker ps --filter "name=test-"
```
4. **Si oui** → Passe à Phase 2
5. **Si non** → Regarde les logs API :
```bash
docker logs wa-api --tail 100 | Select-String "test-"
```

### Phase 2 : Valider que VNC répond

1. Entre dans le conteneur émulateur :
```bash
docker exec -it wa-emulator-test-XXXXXX bash
```

2. Teste si x11vnc écoute sur le port 5900 :
```bash
netstat -tuln | grep 5900
```

3. **Si oui** → Passe à Phase 3
4. **Si non** → Démarre x11vnc manuellement :
```bash
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 &
```

### Phase 3 : Valider la connexion WebSocket

1. Ouvre le navigateur, va sur "Stream"
2. Ouvre la console développeur (F12)
3. Va dans l'onglet "Network"
4. Filtre par "WS" (WebSocket)
5. Tu devrais voir une connexion vers `/vnc/test-XXXXXX/websockify`

6. **Si 502 Bad Gateway** :
   - Nginx ne peut pas résoudre `websockify-test-XXXXXX`
   - Vérifie que les 2 conteneurs sont sur le **même réseau Docker** :
```bash
docker inspect wa-frontend | Select-String "Networks"
docker inspect websockify-test-XXXXXX | Select-String "Networks"
# Les deux doivent être sur "wa-provisioner-network"
```

7. **Si WebSocket connecte mais stream noir** :
   - Le flux VNC ne passe pas correctement
   - Teste la connexion directe vers websockify :
```bash
# Depuis ta machine Windows
curl http://localhost:5900/vnc.html

# Tu devrais voir du HTML (la page noVNC)
```

---

## ✅ **Une fois que ça marche...**

Quand le Mode Test VNC fonctionne correctement :
1. ✅ Le conteneur Android démarre
2. ✅ Websockify démarre
3. ✅ x11vnc répond
4. ✅ Le stream VNC s'affiche dans le navigateur

**Alors on transpose la solution au provisioning complet** :
- On applique les mêmes configurations
- On vérifie que les mêmes étapes sont suivies
- Le VNC devrait maintenant fonctionner aussi dans le provisioning

---

## 📝 **Logs importants**

### Log API (test.routes.ts)
```
Creating test VNC container (Android only)
Test container spawned
Test session created
Checking websockify status (attempt 1/10)
Websockify is ready
Test VNC container is fully ready
```

### Log Docker (émulateur)
```
Starting Android emulator...
Emulator is ready
Starting VNC server on port 5900...
VNC server started successfully
```

### Log Docker (websockify)
```
WebSocket server settings:
  - Listen on :8080
  - Web server on :8080
  - SSL: off
```

---

## 🚀 **Next Steps**

1. **Teste le Mode Test VNC** maintenant
2. **Si ça marche** : VNC fonctionne → Le problème est ailleurs dans le provisioning
3. **Si ça ne marche pas** : Suis le plan d'action ci-dessus pour déboguer
4. **Une fois résolu** : On transpose au provisioning complet

---

**Version** : 3.10.0-test-vnc-debug  
**Date** : 20 novembre 2025  
**Status** : 🧪 Mode Debug actif



## 🎯 **Objectif**

Le **Mode Test VNC** permet de déboguer rapidement les problèmes de connexion VNC/websockify **sans avoir à lancer tout le processus de provisioning WhatsApp**.

### Pourquoi cette fonctionnalité ?

Le provisioning WhatsApp complet prend **2-3 minutes** et inclut :
- ✅ Création du conteneur Android
- ✅ Installation WhatsApp
- ✅ Achat d'un numéro (coût réel)
- ✅ Configuration du compte
- ✅ Injection OTP

**Problème** : Si le VNC ne fonctionne pas, on perd du temps et de l'argent à chaque test.

**Solution** : Le Mode Test VNC lance **UNIQUEMENT** :
- ✅ Conteneur Android (émulateur)
- ✅ Websockify (proxy VNC)
- ✅ Session minimale dans la DB

**Résultat** : Test en **30 secondes** au lieu de 3 minutes, sans coût.

---

## 📋 **Comment utiliser**

### 1️⃣ **Lancer un Test VNC**

1. Va sur **http://localhost:5173**
2. Connecte-toi avec tes identifiants
3. Dans la sidebar, clique sur le bouton bleu **"🧪 Test VNC (Debug Mode)"**

```
┌────────────────────────────┐
│  Search sessions...  [+New]│
│                            │
│  🧪 Test VNC (Debug Mode)  │  ← Clique ici
│                            │
│  🗑️ Delete All Sessions    │
└────────────────────────────┘
```

4. **Attends 30 secondes** pendant que le système :
   - Crée le conteneur Android
   - Lance websockify
   - Attend que VNC soit prêt (10 tentatives de 3 secondes)

5. **Une popup apparaît** :
```
✅ Test VNC container created!

Session ID: test-abc123

Navigate to "Stream" tab to see the Android emulator.
```

6. **Clique sur "Stream" dans le menu du haut** pour voir l'émulateur Android

---

### 2️⃣ **Vérifier que VNC fonctionne**

Si tout va bien, tu devrais voir :
- ✅ L'écran Android dans l'iframe
- ✅ Tu peux voir le launcher Android
- ✅ Pas de "502 Bad Gateway"

Si ça ne marche pas, tu verras :
- ❌ "502 Bad Gateway nginx/1.29.3"
- ❌ "Conteneur VNC inactif"

---

### 3️⃣ **Déboguer un problème**

#### **Étape 1 : Vérifier les conteneurs Docker**

```bash
# Liste tous les conteneurs de test
docker ps -a --filter "name=test-"

# Tu devrais voir 2 conteneurs :
# wa-emulator-test-XXXXXX (émulateur)
# websockify-test-XXXXXX (proxy VNC)
```

#### **Étape 2 : Vérifier les logs du conteneur émulateur**

```bash
# Remplace test-XXXXXX par ton ID de test
docker logs wa-emulator-test-XXXXXX --tail 50

# Cherche des erreurs comme :
# - "VNC server failed to start"
# - "x11vnc: error"
# - "XVFB failed"
```

#### **Étape 3 : Vérifier les logs websockify**

```bash
# Remplace test-XXXXXX par ton ID de test
docker logs websockify-test-XXXXXX --tail 50

# Tu devrais voir :
# "WebSocket server settings:"
# "listening on :8080"
```

#### **Étape 4 : Vérifier la route nginx**

```bash
# Dans le navigateur, ouvre la console développeur (F12)
# Va dans l'onglet "Network"
# Clique sur "Stream"
# Cherche la requête WebSocket qui échoue
```

#### **Étape 5 : Vérifier la résolution DNS**

```bash
# Entre dans le conteneur frontend
docker exec -it wa-frontend sh

# Essaie de résoudre le nom du conteneur websockify
ping websockify-test-XXXXXX

# Si "ping: bad address", c'est un problème DNS
```

---

### 4️⃣ **Nettoyer après les tests**

Les conteneurs de test restent actifs jusqu'à ce que tu les supprimes :

```bash
# Supprimer TOUS les conteneurs de test
docker ps -a --filter "name=test-" --format "{{.Names}}" | ForEach-Object { docker rm -f $_ }

# Ou un par un
docker rm -f wa-emulator-test-XXXXXX
docker rm -f websockify-test-XXXXXX
```

Tu peux aussi les supprimer via l'interface en cliquant sur "🗑️ Delete All Sessions".

---

## 🔧 **Architecture du Mode Test**

### Backend (API)

**Fichier** : `src/routes/test.routes.ts`

**Route** : `POST /test/vnc-container`

**Processus** :
1. Génère un ID de test : `test-{8 caractères aléatoires}`
2. Lance le conteneur Android avec `dockerService.spawnEmulator()`
3. Crée une session dans la DB avec `sessionService.createSession()`
4. **Attend que websockify soit prêt** (10 tentatives × 3 secondes = 30s max)
5. Retourne les infos du test (sessionId, streamUrl, vncPort, etc.)

**Avantage** : Pas de worker, pas de queue, pas de WhatsApp → **Instantané**

### Frontend

**Fichier** : `frontend/src/components/Sidebar.tsx`

**Bouton** : "🧪 Test VNC (Debug Mode)"

**Processus** :
1. Appelle `createTestVncContainer()` (API call)
2. Affiche un spinner pendant la création
3. Refresh les sessions pour afficher la nouvelle session de test
4. Sélectionne automatiquement la session de test
5. Affiche une popup de confirmation

**Fichier API** : `frontend/src/api/test.api.ts`

---

## 📊 **Comparaison : Provisioning vs Test VNC**

| Critère | Provisioning Complet | Mode Test VNC |
|---------|---------------------|---------------|
| **Temps** | 2-3 minutes | 30 secondes |
| **Coût** | ~$0.50 (numéro SMS) | $0 |
| **WhatsApp** | ✅ Installé et configuré | ❌ Pas installé |
| **Numéro** | ✅ Acheté | ❌ Pas de numéro |
| **VNC** | ✅ Fonctionnel | ✅ Fonctionnel |
| **Session DB** | ✅ Complète | ✅ Minimale |
| **Message polling** | ✅ Actif | ❌ Désactivé |
| **But** | Production | Debug uniquement |

---

## 🐛 **Problèmes courants et solutions**

### Problème 1 : "502 Bad Gateway" après création

**Symptôme** :
```
✅ Test VNC container created!
Session ID: test-abc123

[Mais dans Stream]
502 Bad Gateway nginx/1.29.3
```

**Cause** : Websockify n'a pas démarré ou a crashé

**Solution** :
```bash
# Vérifie si websockify existe
docker ps -a --filter "name=websockify-test-abc123"

# Si STATUS = "Exited", regarde les logs
docker logs websockify-test-abc123

# Si le conteneur n'existe pas, regarde les logs de l'API
docker logs wa-api --tail 50
```

---

### Problème 2 : Websockify démarre mais VNC ne répond pas

**Symptôme** :
```
✅ websockify container is running
❌ But the VNC stream shows a black screen or hangs
```

**Cause** : x11vnc (serveur VNC) n'a pas démarré dans l'émulateur

**Solution** :
```bash
# Entre dans le conteneur émulateur
docker exec -it wa-emulator-test-abc123 bash

# Vérifie si x11vnc tourne
ps aux | grep x11vnc

# Si absent, démarre-le manuellement
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 &
```

---

### Problème 3 : "VNC stream container is not active"

**Symptôme** :
```
Conteneur VNC inactif
Le conteneur VNC pour cette session n'est pas actif.
```

**Cause** : Le conteneur émulateur a été supprimé ou a crashé

**Solution** :
```bash
# Vérifie si le conteneur existe
docker ps -a --filter "name=wa-emulator-test-abc123"

# Si STATUS = "Exited", regarde pourquoi il a crashé
docker logs wa-emulator-test-abc123

# Raisons possibles :
# - Mémoire insuffisante (augmente Docker memory limit)
# - Image corrompue (docker pull budtmo/docker-android:latest)
# - Port déjà utilisé (change le port VNC)
```

---

### Problème 4 : Container créé mais websockify pas "ready"

**Symptôme** :
```
⏳ Websockify not ready yet, waiting 3 seconds... (attempt 10/10)
❌ VNC container started but websockify failed to become ready
```

**Cause** : Websockify prend plus de 30 secondes à démarrer

**Solution temporaire** :
1. Augmente `maxRetries` dans `src/routes/test.routes.ts` (ligne 47) :
```typescript
const maxRetries = 15; // Au lieu de 10 → 45 secondes au lieu de 30
```

2. Ou vérifie si websockify a vraiment démarré :
```bash
docker logs websockify-test-abc123

# Tu devrais voir :
# "WebSocket server settings:"
# "listening on :8080"
```

---

## 🎯 **Plan d'action pour déboguer VNC**

### Phase 1 : Valider que websockify démarre

1. Clique sur "🧪 Test VNC (Debug Mode)"
2. Attends la popup de confirmation
3. Vérifie que **2 conteneurs** ont été créés :
```bash
docker ps --filter "name=test-"
```
4. **Si oui** → Passe à Phase 2
5. **Si non** → Regarde les logs API :
```bash
docker logs wa-api --tail 100 | Select-String "test-"
```

### Phase 2 : Valider que VNC répond

1. Entre dans le conteneur émulateur :
```bash
docker exec -it wa-emulator-test-XXXXXX bash
```

2. Teste si x11vnc écoute sur le port 5900 :
```bash
netstat -tuln | grep 5900
```

3. **Si oui** → Passe à Phase 3
4. **Si non** → Démarre x11vnc manuellement :
```bash
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 &
```

### Phase 3 : Valider la connexion WebSocket

1. Ouvre le navigateur, va sur "Stream"
2. Ouvre la console développeur (F12)
3. Va dans l'onglet "Network"
4. Filtre par "WS" (WebSocket)
5. Tu devrais voir une connexion vers `/vnc/test-XXXXXX/websockify`

6. **Si 502 Bad Gateway** :
   - Nginx ne peut pas résoudre `websockify-test-XXXXXX`
   - Vérifie que les 2 conteneurs sont sur le **même réseau Docker** :
```bash
docker inspect wa-frontend | Select-String "Networks"
docker inspect websockify-test-XXXXXX | Select-String "Networks"
# Les deux doivent être sur "wa-provisioner-network"
```

7. **Si WebSocket connecte mais stream noir** :
   - Le flux VNC ne passe pas correctement
   - Teste la connexion directe vers websockify :
```bash
# Depuis ta machine Windows
curl http://localhost:5900/vnc.html

# Tu devrais voir du HTML (la page noVNC)
```

---

## ✅ **Une fois que ça marche...**

Quand le Mode Test VNC fonctionne correctement :
1. ✅ Le conteneur Android démarre
2. ✅ Websockify démarre
3. ✅ x11vnc répond
4. ✅ Le stream VNC s'affiche dans le navigateur

**Alors on transpose la solution au provisioning complet** :
- On applique les mêmes configurations
- On vérifie que les mêmes étapes sont suivies
- Le VNC devrait maintenant fonctionner aussi dans le provisioning

---

## 📝 **Logs importants**

### Log API (test.routes.ts)
```
Creating test VNC container (Android only)
Test container spawned
Test session created
Checking websockify status (attempt 1/10)
Websockify is ready
Test VNC container is fully ready
```

### Log Docker (émulateur)
```
Starting Android emulator...
Emulator is ready
Starting VNC server on port 5900...
VNC server started successfully
```

### Log Docker (websockify)
```
WebSocket server settings:
  - Listen on :8080
  - Web server on :8080
  - SSL: off
```

---

## 🚀 **Next Steps**

1. **Teste le Mode Test VNC** maintenant
2. **Si ça marche** : VNC fonctionne → Le problème est ailleurs dans le provisioning
3. **Si ça ne marche pas** : Suis le plan d'action ci-dessus pour déboguer
4. **Une fois résolu** : On transpose au provisioning complet

---

**Version** : 3.10.0-test-vnc-debug  
**Date** : 20 novembre 2025  
**Status** : 🧪 Mode Debug actif

























