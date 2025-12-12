# 📝 Changelog

## [3.9.0-early-session-vnc-test] - 2025-11-20

### ✨ **Améliorations UX et Provisioning**

#### 🔐 **Confirmation de suppression**
- ✅ **Modal de confirmation** pour "Delete All Sessions"
- ✅ Affiche le nombre de sessions qui seront supprimées
- ✅ Design clair avec icône d'avertissement
- ✅ Boutons "Annuler" et "Supprimer tout"

#### 🚀 **Modal de provisioning simplifié**
- ✅ Retrait du champ "Label" (inutile)
- ✅ Retrait de la checkbox "Link to WhatsApp Web" (non implémentée)
- ✅ Design modernisé avec icône WhatsApp
- ✅ **Un seul gros bouton** : "🚀 Démarrer le Provisioning"
- ✅ Information claire sur la durée (2-3 minutes)
- ✅ Auto-détection du pays visible

#### 🖥️ **Session créée plus tôt + Test VNC**
- ✅ **Session créée dès le spawn du conteneur Android** (avant WhatsApp)
- ✅ **Test VNC automatique** avant de commencer le provisioning WhatsApp
- ✅ Logs détaillés de la création de session :
  - Session ID
  - Port VNC
  - URL du stream
- ✅ **Vérification que le websockify est opérationnel**
- ✅ **Retry automatique** si websockify n'est pas encore prêt (attente 3s)
- ✅ Le stream VNC est disponible **IMMÉDIATEMENT** après le spawn

#### 📋 **Bénéfices**

**Avant** :
```
1. Spawn conteneur
2. Lancer WhatsApp
3. Acheter numéro
4. ...
5. Créer session (à la fin)
6. Stream disponible uniquement à la fin
```

**Maintenant** :
```
1. Spawn conteneur
2. ✅ Créer session IMMÉDIATEMENT
3. ✅ Tester VNC (stream disponible de suite)
4. Lancer WhatsApp
5. Acheter numéro
6. ...
```

#### 🎯 **Résultat**

- **Stream VNC disponible dès le début** du provisioning
- Tu peux voir l'écran Android **même pendant le setup WhatsApp**
- Détection précoce des problèmes VNC
- Meilleure expérience utilisateur

#### 🔧 **Fichiers modifiés**
- `frontend/src/components/Sidebar.tsx` - Ajout confirmation suppression
- `frontend/src/components/ProvisionModal.tsx` - Modal simplifié
- `src/workers/provision.worker.ts` - Session créée tôt + test VNC
- `VERSION` → 3.9.0-early-session-vnc-test
- `src/workers/otp.worker.ts` → WORKER_VERSION updated
- `frontend/src/components/Sidebar.tsx` → Version display updated

---

## [3.8.2-websockify-validation] - 2025-11-19

### 🐛 **Correction du 502 Bad Gateway dans Stream View**

#### 🔍 **Problème identifié**
- **Erreur 502** : Lorsqu'une session sans conteneur websockify actif était sélectionnée
- **Cause** : nginx essayait de router vers `websockify-{sessionId}:8080` mais le conteneur n'existait pas
- **Impact** : Les anciennes sessions (échouées ou supprimées) affichaient une erreur 502 au lieu d'un message clair

#### ✅ **Solutions implémentées**

**1. Validation côté backend**
- ✅ Nouvelle méthode `dockerService.isWebsockifyRunning(sessionId)` 
- ✅ Vérification dans `/sessions/:id/stream` avant de retourner l'URL
- ✅ Retourne `503 Service Unavailable` avec message explicite si conteneur inactif

```typescript
// src/services/docker.service.ts
async isWebsockifyRunning(sessionId: string): Promise<boolean> {
  const container = docker.getContainer(`websockify-${sessionId}`);
  const inspect = await container.inspect();
  return inspect.State.Running;
}
```

**2. Gestion d'erreurs côté frontend**
- ✅ Détection automatique des erreurs 502/503
- ✅ Message d'erreur différencié : "Conteneur VNC inactif"
- ✅ Instructions claires pour l'utilisateur
- ✅ Pas de bouton "Réessayer" si le conteneur n'existe pas

**3. Script de nettoyage**
- ✅ `scripts/cleanup-orphan-sessions.ts` pour identifier et nettoyer les sessions orphelines
- ✅ Détecte les sessions sans conteneur émulateur ou websockify
- ✅ Marque les sessions orphelines comme `isActive: false`
- ✅ Mode interactif avec confirmation avant suppression

---

## [3.8.1-websockify-proxy] - 2025-11-18

### 🖥️ **Proxy Websockify Séparé**

#### 🔧 **Amélioration de l'architecture VNC**
- Container websockify dédié pour chaque émulateur
- Utilise l'image `theasp/novnc:latest` au lieu de `ghcr.io/novnc/websockify`
- Port 8080 exposé uniquement sur le réseau Docker (pas d'exposition sur l'hôte)
- Nginx accède aux conteneurs websockify via le réseau interne

---

## [3.8.0-vnc-stream-fixed] - 2025-11-18

### 🖥️ **Stream VNC Réparé et Amélioré**

#### 🔧 **Problème résolu**
- **Avant** : Le StreamView essayait d'accéder directement à `http://localhost:{port}/vnc.html`
- **Problème** : Le navigateur ne peut pas accéder aux ports de l'hôte Docker
- **Solution** : Utilisation du proxy nginx `/vnc/{port}/*` qui route vers `host.docker.internal:{port}/*`

#### ✨ **Nouvelles fonctionnalités**

**1. Contrôles VNC améliorés**
- ✅ Bouton **Reconnecter** pour recharger le stream
- ✅ Bouton **Plein écran** pour une meilleure expérience
- ✅ Indicateur de connexion (vert = connecté, jaune = en cours)

**2. Gestion d'erreurs améliorée**
- ✅ Messages d'erreur clairs et informatifs
- ✅ Loader pendant la connexion
- ✅ Possibilité de réessayer en cas d'échec

---

_... (reste du changelog existant)_
