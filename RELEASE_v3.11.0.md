# Release Notes - Version 3.11.0 "Progress Bar" 🎯

**Date:** 21 novembre 2025  
**Type:** Feature Release + Bug Fix

---

## 🎉 Nouveautés

### 1. Barre de Progression Test VNC ✅
- **Nouveau modal de progression** lors de la création d'un conteneur Test VNC
- Affichage de **4 étapes détaillées** :
  1. ✅ Création du conteneur de test
  2. ✅ Démarrage de l'émulateur Android
  3. ✅ Initialisation du stream VNC
  4. ✅ Prêt à utiliser
- **Pourcentage global** pour suivre la progression en temps réel
- **Indicateurs visuels** : spinner animé, checkmarks, barre de progression
- **Messages d'erreur clairs** en cas de problème
- **Auto-sélection** de la session une fois le test créé

### 2. Nettoyage Automatique des Tests VNC 🧹
- **Suppression automatique** des anciens conteneurs de test avant d'en créer un nouveau
- Évite les **conflits de ports** (4723, 5555, 5900)
- **Marquage des anciennes sessions** comme inactives dans la base de données
- Permet de cliquer plusieurs fois sur "Test VNC" sans erreurs

---

## 🐛 Correctifs

### VNC Stream - 502 Bad Gateway Résolu ✅
**Problème :** Le service `vnc_web` (noVNC intégré) de l'image `budtmo/docker-android` crashait constamment et entrait en état FATAL, causant des erreurs 502 Bad Gateway.

**Solution :**
- ✅ Création d'un **conteneur websockify séparé** (`jwnmulder/websockify:latest`)
- ✅ Connexion directe au VNC de l'émulateur (port 5900)
- ✅ Exposition d'une interface noVNC stable sur le port 8080
- ✅ Résolution DNS dynamique dans Nginx

**Impact :** Le VNC affiche maintenant correctement l'émulateur Android au lieu du bureau Linux.

---

## 🔧 Améliorations Techniques

### Architecture
```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   Nginx     │─────▶│  websockify  │─────▶│  wa-emulator    │
│  (Frontend) │      │   (8080)     │      │  VNC (5900)     │
└─────────────┘      └──────────────┘      └─────────────────┘
```

### Fichiers Modifiés
- `src/services/docker.service.ts` : Ajout de `startWebsockifyProxy()`, restauration de `isWebsockifyRunning()`
- `src/routes/test.routes.ts` : Nettoyage automatique des anciens tests
- `frontend/nginx.conf` : Route vers `websockify-{provisionId}:8080`
- `frontend/src/components/TestVncProgressModal.tsx` : **NOUVEAU** composant de progression
- `frontend/src/components/Sidebar.tsx` : Intégration du modal de progression
- `VERSION` : Mise à jour vers `3.11.0-progress-bar`

---

## 🚀 Migration

### Pour les utilisateurs existants
1. **Rebuild** les conteneurs :
   ```bash
   docker-compose build --build-arg CACHE_BUST=$(date +%s) worker frontend api
   ```

2. **Redémarrer** les services :
   ```bash
   docker-compose stop worker frontend api
   docker-compose rm -f worker frontend api
   docker-compose up -d worker frontend api
   ```

3. **Nettoyer** les anciens conteneurs de test (si nécessaire) :
   ```bash
   docker rm -f $(docker ps -aq --filter "name=wa-emulator-test")
   docker rm -f $(docker ps -aq --filter "name=websockify-test")
   ```

### Pas de changement de schéma de base de données requis ✅

---

## 📊 Logs & Débogage

### Vérifier le statut de websockify
```bash
docker logs websockify-<sessionId>
```

### Vérifier la connexion VNC
```bash
docker exec wa-api curl -I http://websockify-<sessionId>:8080
```

### Logs du Test VNC
Les logs sont maintenant plus détaillés lors de la création d'un test VNC :
- ✅ Nettoyage des anciens conteneurs
- ✅ Création du conteneur
- ✅ Démarrage de websockify
- ✅ Vérification de la disponibilité (10 tentatives max)

---

## 🎯 Prochaines Étapes (v3.12.0)

- [ ] Améliorer la gestion des erreurs de provisioning
- [ ] Ajouter des indicateurs de santé pour les conteneurs
- [ ] Optimiser le temps de démarrage des émulateurs
- [ ] Ajouter des métriques de performance

---

## 🙏 Remerciements

Merci à l'utilisateur pour avoir identifié et remonté le problème du 502 Bad Gateway et demandé l'ajout de la barre de progression !

---

**Version:** 3.11.0-progress-bar  
**Compatibilité:** Toutes les versions 3.x  
**Statut:** ✅ Stable



**Date:** 21 novembre 2025  
**Type:** Feature Release + Bug Fix

---

## 🎉 Nouveautés

### 1. Barre de Progression Test VNC ✅
- **Nouveau modal de progression** lors de la création d'un conteneur Test VNC
- Affichage de **4 étapes détaillées** :
  1. ✅ Création du conteneur de test
  2. ✅ Démarrage de l'émulateur Android
  3. ✅ Initialisation du stream VNC
  4. ✅ Prêt à utiliser
- **Pourcentage global** pour suivre la progression en temps réel
- **Indicateurs visuels** : spinner animé, checkmarks, barre de progression
- **Messages d'erreur clairs** en cas de problème
- **Auto-sélection** de la session une fois le test créé

### 2. Nettoyage Automatique des Tests VNC 🧹
- **Suppression automatique** des anciens conteneurs de test avant d'en créer un nouveau
- Évite les **conflits de ports** (4723, 5555, 5900)
- **Marquage des anciennes sessions** comme inactives dans la base de données
- Permet de cliquer plusieurs fois sur "Test VNC" sans erreurs

---

## 🐛 Correctifs

### VNC Stream - 502 Bad Gateway Résolu ✅
**Problème :** Le service `vnc_web` (noVNC intégré) de l'image `budtmo/docker-android` crashait constamment et entrait en état FATAL, causant des erreurs 502 Bad Gateway.

**Solution :**
- ✅ Création d'un **conteneur websockify séparé** (`jwnmulder/websockify:latest`)
- ✅ Connexion directe au VNC de l'émulateur (port 5900)
- ✅ Exposition d'une interface noVNC stable sur le port 8080
- ✅ Résolution DNS dynamique dans Nginx

**Impact :** Le VNC affiche maintenant correctement l'émulateur Android au lieu du bureau Linux.

---

## 🔧 Améliorations Techniques

### Architecture
```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   Nginx     │─────▶│  websockify  │─────▶│  wa-emulator    │
│  (Frontend) │      │   (8080)     │      │  VNC (5900)     │
└─────────────┘      └──────────────┘      └─────────────────┘
```

### Fichiers Modifiés
- `src/services/docker.service.ts` : Ajout de `startWebsockifyProxy()`, restauration de `isWebsockifyRunning()`
- `src/routes/test.routes.ts` : Nettoyage automatique des anciens tests
- `frontend/nginx.conf` : Route vers `websockify-{provisionId}:8080`
- `frontend/src/components/TestVncProgressModal.tsx` : **NOUVEAU** composant de progression
- `frontend/src/components/Sidebar.tsx` : Intégration du modal de progression
- `VERSION` : Mise à jour vers `3.11.0-progress-bar`

---

## 🚀 Migration

### Pour les utilisateurs existants
1. **Rebuild** les conteneurs :
   ```bash
   docker-compose build --build-arg CACHE_BUST=$(date +%s) worker frontend api
   ```

2. **Redémarrer** les services :
   ```bash
   docker-compose stop worker frontend api
   docker-compose rm -f worker frontend api
   docker-compose up -d worker frontend api
   ```

3. **Nettoyer** les anciens conteneurs de test (si nécessaire) :
   ```bash
   docker rm -f $(docker ps -aq --filter "name=wa-emulator-test")
   docker rm -f $(docker ps -aq --filter "name=websockify-test")
   ```

### Pas de changement de schéma de base de données requis ✅

---

## 📊 Logs & Débogage

### Vérifier le statut de websockify
```bash
docker logs websockify-<sessionId>
```

### Vérifier la connexion VNC
```bash
docker exec wa-api curl -I http://websockify-<sessionId>:8080
```

### Logs du Test VNC
Les logs sont maintenant plus détaillés lors de la création d'un test VNC :
- ✅ Nettoyage des anciens conteneurs
- ✅ Création du conteneur
- ✅ Démarrage de websockify
- ✅ Vérification de la disponibilité (10 tentatives max)

---

## 🎯 Prochaines Étapes (v3.12.0)

- [ ] Améliorer la gestion des erreurs de provisioning
- [ ] Ajouter des indicateurs de santé pour les conteneurs
- [ ] Optimiser le temps de démarrage des émulateurs
- [ ] Ajouter des métriques de performance

---

## 🙏 Remerciements

Merci à l'utilisateur pour avoir identifié et remonté le problème du 502 Bad Gateway et demandé l'ajout de la barre de progression !

---

**Version:** 3.11.0-progress-bar  
**Compatibilité:** Toutes les versions 3.x  
**Statut:** ✅ Stable

















