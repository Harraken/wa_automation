# 📱 WhatsApp Automation System

Système d'automatisation WhatsApp avec provisioning automatique, gestion de sessions et communication bidirectionnelle.

---

## 🚀 Démarrage rapide

### **1. Démarrer le projet**
```powershell
# Windows
.\up.ps1

# Linux/Mac
chmod +x *.sh
./up.sh
```

Le système va :
- ✅ Builder les images Docker avec cache intelligent
- ✅ Démarrer tous les services (API, Worker, Frontend, PostgreSQL, Redis)
- ✅ Créer automatiquement les tables de la base de données
- ✅ Être accessible sur http://localhost:5173

### **2. Utiliser l'application**
1. Ouvrir http://localhost:5173
2. Cliquer sur "Start provisioning"
3. Le système va automatiquement :
   - Acheter un numéro de téléphone (US/Canada)
   - Créer un compte WhatsApp
   - Tester l'envoi de messages via deeplink
   - Marquer le compte comme actif

### **3. Arrêter le projet**
```powershell
# Windows
.\down.ps1

# Linux/Mac
./down.sh
```

---

## 📋 Commandes disponibles

| Commande | Description |
|----------|-------------|
| `.\up.ps1` / `./up.sh` | **Démarre le projet** (cache busting automatique) |
| `.\down.ps1` / `./down.sh` | **Arrête le projet** |
| `.\reset.ps1` / `./reset.sh` | **Reset complet** (supprime tout) |
| `.\build.ps1` / `./build.sh` | Builder sans démarrer (avancé) |

---

## ⚙️ Configuration

### **Variables d'environnement**

Créer un fichier `.env` à la racine :

```env
# SMS Providers
SMSMAN_TOKEN=your_token_here
ONLINESIM_API_KEY=your_api_key_here

# Security
JWT_SECRET=your_secret_here
AGENT_AUTH_SECRET=your_agent_secret_here
```

Les clés actuelles sont déjà configurées dans `docker-compose.yml` mais vous pouvez les surcharger avec un fichier `.env`.

---

## 🔧 Architecture

### **Services**

- **Frontend** (React + Vite) : http://localhost:5173
- **API** (Node.js + Express) : http://localhost:3000
- **Worker** (BullMQ) : Gestion des jobs asynchrones
- **PostgreSQL** : Base de données
- **Redis** : Queue de jobs

### **Fonctionnalités**

✅ **Provisioning automatique** :
- Achat de numéros (OnlineSim/SMS-MAN)
- Création de conteneurs Android (Docker)
- Installation et configuration WhatsApp
- Injection OTP automatique
- Configuration du profil

✅ **Envoi de messages** :
- Deeplink WhatsApp (pas de création de contact)
- Temps d'envoi : ~5-10 secondes
- Test automatique après provisioning

✅ **Réception de messages** :
- Polling automatique toutes les 3 secondes
- Affichage temps réel dans l'interface
- Son + notifications navigateur

✅ **Gestion des sessions** :
- Liste des comptes actifs
- Logs détaillés par session
- Capture d'écran en temps réel
- Suppression avec conteneurs associés

---

## 📦 Cache Busting Docker

Le projet utilise un système de **cache busting automatique** pour garantir que les changements de code sont TOUJOURS pris en compte.

### **Comment ça marche ?**

Les scripts `up.ps1` et `up.sh` :
1. Génèrent un timestamp unique à chaque démarrage
2. Le passent à Docker via `--build-arg CACHE_BUST=<timestamp>`
3. Docker invalide le cache et recompile le code source

### **Pourquoi ?**

Docker réutilise parfois l'ancien code en cache même après modifications. Ce système garantit que **chaque démarrage utilise le code le plus récent**.

Voir [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) pour plus de détails.

---

## 🐛 Dépannage

### **Les changements de code ne sont pas pris en compte**
```powershell
# Force le rebuild
.\up.ps1 --build
```

### **Erreur "Failed to create provision"**
```powershell
# Réinitialiser la base de données
docker-compose exec api npx prisma migrate reset --force
docker-compose restart api
```

### **Reset complet**
```powershell
# Supprime tout et redémarre
.\reset.ps1
.\up.ps1 --build
```

### **Voir les logs**
```powershell
# Tous les services
docker-compose logs -f

# Un service spécifique
docker-compose logs -f worker
docker-compose logs -f api
```

---

## 📚 Documentation

- [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) : Guide de build détaillé
- [CHANGELOG.md](CHANGELOG.md) : Historique des versions
- [WHATSAPP_PROVISIONING_PROCESS.md](WHATSAPP_PROVISIONING_PROCESS.md) : Détails du provisioning

---

## 🚀 Versions

- **3.1.0-deeplink-test** : Version actuelle avec deeplink et cache busting
- **3.0.0-deeplink** : Introduction du système de deeplink WhatsApp

---

## ⚠️ Important

### **NE PLUS UTILISER** :
```bash
❌ docker-compose up          # Pas de cache busting
❌ docker-compose build       # Cache problématique
```

### **UTILISER** :
```bash
✅ .\up.ps1                   # Avec cache busting automatique
✅ .\down.ps1                 # Arrêt propre
✅ .\reset.ps1                # Reset complet
```

---

## 📝 License

MIT
