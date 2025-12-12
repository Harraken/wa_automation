# 🔍 Diagnostic VNC Stream - Version 3.8.0

## ✅ **Problème résolu**

### **Avant (version 3.7.x)**
```
❌ StreamView → http://localhost:{port}/vnc.html
   ↓
   ❌ CORS / Port inaccessible depuis le navigateur
```

### **Maintenant (version 3.8.0)**
```
✅ StreamView → /vnc/{port}/vnc.html
   ↓
   ✅ Nginx Proxy → host.docker.internal:{port}/vnc.html
   ↓
   ✅ Conteneur Android (noVNC sur port 6080)
```

---

## 🎯 **Architecture VNC**

### **1. Conteneur Android Emulator**
```yaml
# docker-compose (provision.worker.ts crée dynamiquement)
Container: wa-emulator-{sessionId}
Image: budtmo/docker-android
Ports:
  - 6080 → {vncPort dynamique} (noVNC web)
  - 4723 → {appiumPort dynamique} (Appium)
  - 5555 → {adbPort dynamique} (ADB)
```

### **2. Nginx Proxy (Frontend Container)**
```nginx
# frontend/nginx.conf
location ~ ^/vnc/([0-9]+)/(.*)$ {
    proxy_pass http://host.docker.internal:$1/$2$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_read_timeout 86400;
}
```

**Explication** :
- `^/vnc/([0-9]+)/(.*)$` : Capture le port `[0-9]+` et le chemin `.*`
- `$1` : Premier groupe capturé (le port VNC)
- `$2` : Deuxième groupe capturé (le chemin, ex: `vnc.html`)
- `host.docker.internal` : Résout vers l'hôte Docker depuis le conteneur

### **3. StreamView Component**
```typescript
// frontend/src/components/StreamView.tsx
const vncUrl = `/vnc/${session.vncPort}/vnc.html?autoconnect=true&resize=scale`;

<iframe
  src={vncUrl}
  allow="clipboard-read; clipboard-write"
  title="VNC Stream"
/>
```

---

## ✨ **Nouvelles Fonctionnalités**

### **1. Bouton Reconnecter** 🔄
- Force le rechargement du stream VNC
- Utile si la connexion est perdue

### **2. Bouton Plein Écran** ⛶
- Affiche le stream en plein écran
- Appuyez sur `Échap` ou cliquez sur "Quitter" pour sortir

### **3. Indicateurs de Status**
- 🟢 **Vert** : Connecté et prêt
- 🟡 **Jaune clignotant** : Connexion en cours
- ⚠️ **Erreur** : Message d'erreur avec bouton "Réessayer"

### **4. Loader pendant la connexion**
- Overlay semi-transparent avec spinner
- S'affiche pendant le chargement initial

---

## 🧪 **Comment tester**

### **Étape 1 : Vérifier la version**
1. Ouvre l'interface : `http://localhost:5173`
2. Fais un **hard refresh** : `Ctrl+F5` (Windows) ou `Cmd+Shift+R` (Mac)
3. Vérifie en bas de la sidebar : `Version: 3.8.0-vnc-stream-fixed`

### **Étape 2 : Lancer une provision**
1. Clique sur **"+ Nouvelle Session"**
2. Attends que le conteneur démarre (~30 secondes)
3. Une fois la session créée, clique dessus dans la liste

### **Étape 3 : Ouvrir le Stream VNC**
1. Dans le panneau principal, clique sur l'onglet **"Stream"**
2. Tu devrais voir :
   - Un loader "Connexion au stream VNC..."
   - Puis l'écran Android apparaît

### **Étape 4 : Prendre le contrôle**
- **Clic** : Interagit avec l'écran Android
- **Clavier** : Tape du texte (si un champ est sélectionné)
- **Copier-Coller** : Fonctionne entre ton PC et l'émulateur
- **Plein écran** : Clique sur le bouton ⛶ pour une meilleure vue

---

## 🔧 **Diagnostic en cas de problème**

### **Problème 1 : "Port VNC non disponible"**

**Cause** : Le conteneur n'a pas encore démarré ou n'a pas de port VNC assigné

**Solution** :
1. Attends 30 secondes de plus
2. Vérifie les logs du conteneur :
   ```powershell
   docker logs wa-emulator-{sessionId}
   ```
3. Vérifie que le port est bien mappé :
   ```powershell
   docker ps | findstr emulator
   ```

### **Problème 2 : "Stream VNC non disponible"**

**Cause** : Le service noVNC n'est pas démarré dans le conteneur

**Solution** :
1. Clique sur le bouton **"🔄 Réessayer"**
2. Vérifie que le conteneur a bien noVNC installé :
   ```powershell
   docker exec wa-emulator-{sessionId} which websockify
   ```
3. Vérifie les logs du conteneur

### **Problème 3 : Loader infini**

**Cause** : Le proxy nginx ne peut pas atteindre `host.docker.internal`

**Solution** :
1. Vérifie le docker-compose.yml :
   ```yaml
   frontend:
     extra_hosts:
       - "host.docker.internal:host-gateway"  # ← Doit être présent
   ```
2. Redémarre le frontend :
   ```powershell
   docker-compose restart frontend
   ```

### **Problème 4 : CORS ou 502 Bad Gateway**

**Cause** : Le port VNC n'est pas accessible depuis nginx

**Solution** :
1. Teste l'accès direct au port VNC depuis l'hôte :
   ```powershell
   curl http://localhost:{vncPort}/vnc.html
   ```
2. Si ça fonctionne en direct mais pas via nginx, vérifie les logs nginx :
   ```powershell
   docker-compose logs frontend
   ```

### **Problème 5 : Écran noir**

**Cause** : L'émulateur Android n'a pas encore fini de démarrer

**Solution** :
1. Attends 1-2 minutes (le boot complet peut prendre du temps)
2. Clique sur **"🔄 Reconnecter"**
3. Vérifie les logs du conteneur pour voir la progression du boot

---

## 📊 **Vérification technique**

### **1. Vérifier que le conteneur Android expose bien le port VNC**
```powershell
# Liste tous les conteneurs émulateurs
docker ps --filter "label=whatsapp-provisioner=true"

# Exemple de résultat attendu :
# CONTAINER ID   PORTS
# abc123...      0.0.0.0:5901->6080/tcp  ← Port 5901 (hôte) → 6080 (conteneur noVNC)
```

### **2. Tester l'accès direct au VNC depuis l'hôte**
```powershell
# Remplace {vncPort} par le port affiché dans l'interface
curl http://localhost:{vncPort}/vnc.html
# ✅ Devrait retourner du HTML
```

### **3. Tester l'accès via le proxy nginx**
```powershell
# Depuis ton navigateur ou curl
curl http://localhost:5173/vnc/{vncPort}/vnc.html
# ✅ Devrait retourner du HTML
```

### **4. Vérifier les logs du proxy nginx**
```powershell
docker-compose logs frontend | Select-String "vnc"
# Regarde s'il y a des erreurs de proxy
```

### **5. Inspecter le trafic WebSocket**
Ouvre les **DevTools** du navigateur (`F12`) :
1. Va dans l'onglet **Network**
2. Filtre par **WS** (WebSocket)
3. Tu devrais voir des connexions vers `/vnc/{port}/websockify`
4. Status **101 Switching Protocols** = ✅ OK

---

## ✅ **Checklist de validation**

- [ ] Version `3.8.0-vnc-stream-fixed` affichée dans l'interface
- [ ] Hard refresh effectué (`Ctrl+F5`)
- [ ] Session créée avec succès
- [ ] Onglet "Stream" accessible
- [ ] Loader "Connexion au stream VNC..." s'affiche
- [ ] Écran Android visible dans l'iframe
- [ ] Boutons "Reconnecter" et "Plein écran" fonctionnels
- [ ] Clic sur l'écran Android fonctionne
- [ ] Le port VNC est affiché dans la barre de contrôle

---

## 🎉 **Résultat attendu**

Tu devrais pouvoir :
1. ✅ Voir l'écran Android en temps réel
2. ✅ Cliquer et interagir avec l'interface
3. ✅ Voir WhatsApp s'ouvrir et les automations se dérouler
4. ✅ Prendre le contrôle manuel si besoin
5. ✅ Passer en plein écran pour une meilleure vue
6. ✅ Reconnecter en cas de déconnexion

---

## 📝 **Notes importantes**

### **Performances**
- Le stream VNC peut avoir ~1-2 secondes de latence (normal)
- La qualité vidéo est optimisée pour la bande passante
- Utilisez `resize=scale` pour adapter automatiquement la taille

### **Sécurité**
- Le VNC n'a pas de mot de passe (OK car localhost uniquement)
- **ATTENTION** : Ne pas exposer ces ports sur Internet sans authentification
- Le proxy nginx est configuré pour accepter uniquement les connexions locales

### **Limitations**
- Pas de son (noVNC ne supporte pas l'audio)
- Pas de transfert de fichiers (utilise ADB pour ça)
- Copier-coller peut ne pas fonctionner sur tous les navigateurs

---

## 🆘 **Support**

Si le stream VNC ne fonctionne toujours pas après avoir suivi ce diagnostic :

1. **Collecte les informations** :
   ```powershell
   # Version déployée
   docker-compose exec -T api cat /app/VERSION
   
   # État des conteneurs
   docker ps --filter "label=whatsapp-provisioner=true"
   
   # Logs frontend
   docker-compose logs frontend --tail=50 > logs_frontend.txt
   
   # Logs d'un conteneur émulateur
   docker logs wa-emulator-{sessionId} > logs_emulator.txt
   ```

2. **Vérifie les prérequis Docker** :
   - Docker Desktop en cours d'exécution
   - Réseau `wa-provisioner-network` existe
   - Ports 5173, 3000, 5432, 6379 disponibles

3. **Redémarre tout** :
   ```powershell
   docker-compose down
   docker-compose up -d
   ```

---

✨ **Bon provisioning !** 🚀


