# 🔨 Build Instructions

## Problème résolu
Docker utilise un système de cache qui peut parfois **ne pas détecter les changements de code source**. Ce guide documente la solution mise en place pour garantir que **tous les changements de code sont TOUJOURS pris en compte**.

---

## 🚀 Utilisation quotidienne (RECOMMANDÉ)

### **Démarrer le projet**
```powershell
# Windows
.\up.ps1

# Linux/Mac
chmod +x up.sh
./up.sh
```

**Options disponibles** :
```powershell
.\up.ps1          # Démarre en mode détaché (-d automatique)
.\up.ps1 --build  # Force le rebuild puis démarre
.\up.ps1 -d --build  # Rebuild + mode détaché
```

### **Arrêter le projet**
```powershell
# Windows
.\down.ps1

# Linux/Mac
./down.sh
```

### **Reset complet (supprime tout)**
```powershell
# Windows
.\reset.ps1

# Linux/Mac
./reset.sh
```

---

## 🔨 Build avancé (rarement nécessaire)

### **Builder sans démarrer**
```powershell
# Windows
.\build.ps1

# Linux/Mac
./build.sh
```

### **Builder un service spécifique**
```powershell
# Windows
.\build.ps1 worker

# Linux/Mac
./build.sh worker
```

---

## 🔧 Comment ça marche ?

### **1. Cache Busting**
Les Dockerfiles utilisent un argument `CACHE_BUST` qui change à chaque build :

```dockerfile
ARG CACHE_BUST=1
RUN echo "Cache bust: $CACHE_BUST"
```

Cet argument est placé **juste avant** la copie du code source (`COPY src ./src`), ce qui force Docker à reconstruire toutes les étapes suivantes quand `CACHE_BUST` change.

### **2. Scripts de build automatiques**
Les scripts `build.sh` et `build.ps1` :
- Génèrent automatiquement un timestamp unique
- Le passent à Docker via `--build-arg CACHE_BUST=<timestamp>`
- Garantissent que chaque build inclut les derniers changements

### **3. Configuration docker-compose.yml**
```yaml
api:
  build:
    context: .
    dockerfile: Dockerfile
    target: api
    args:
      CACHE_BUST: ${CACHE_BUST:-1}
```

---

## ⚠️ Important

### **NE PLUS UTILISER** (ancien système, cache problématique) :
```bash
❌ docker-compose up
❌ docker-compose build
❌ docker-compose build --no-cache  # Trop lent
```

### **UTILISER À LA PLACE** (nouveau système, cache intelligent) :
```bash
✅ ./up.ps1                         # Démarre avec cache busting automatique
✅ ./down.ps1                       # Arrête les services
✅ ./reset.ps1                      # Reset complet
```

---

## 🎯 Avantages de cette approche

1. **✅ Toujours à jour** : Les changements de code sont TOUJOURS détectés
2. **⚡ Rapide** : Le cache Docker est utilisé pour les dépendances (npm install)
3. **🎯 Précis** : Seul le code source invalide le cache, pas les dépendances
4. **🔄 Reproductible** : Même comportement sur tous les environnements

---

## 📊 Exemple de sortie

```
🔨 Building Docker images with CACHE_BUST=1731000000
📦 This ensures all code changes are included
...
Step 19/25 : ARG CACHE_BUST=1
Step 20/25 : RUN echo "Cache bust: $CACHE_BUST"
 ---> Running in abc123...
Cache bust: 1731000000
...
✅ Build complete! All code changes have been included.
💡 To start services: docker-compose up -d
```

---

## 🐛 Dépannage

### Les changements ne sont toujours pas pris en compte ?
1. Vérifier que vous utilisez bien le script `build.ps1` ou `build.sh`
2. Supprimer complètement les images et rebuilder :
   ```bash
   docker-compose down --rmi all
   ./build.ps1  # ou ./build.sh
   docker-compose up -d
   ```

### Le build est trop lent ?
Les dépendances npm sont toujours en cache, seul le code source est recompilé. C'est normal et optimal.

---

## 📝 Versions

- **3.0.0-deeplink** : Système de deeplink WhatsApp
- **3.1.0-deeplink-test** : Test automatique du deeplink + système de cache busting

