# ⚡ Démarrage rapide (2 minutes)

## 🚀 En 3 commandes

### **1. Démarrer le projet**
```powershell
.\up.ps1 --build
```

### **2. Ouvrir l'interface**
Aller sur : http://localhost:5173

### **3. Créer un compte WhatsApp**
Cliquer sur **"Start provisioning"**

---

## ✅ C'est tout !

Le système va automatiquement :
- Acheter un numéro de téléphone (US/Canada)
- Créer un conteneur Android
- Installer WhatsApp
- Créer un compte
- Tester l'envoi de messages
- Marquer le compte comme actif (~3-4 minutes)

---

## 📋 Commandes essentielles

```powershell
.\up.ps1          # Démarrer
.\down.ps1        # Arrêter
.\reset.ps1       # Reset complet
```

---

## 🎯 Prochaines étapes

Une fois le compte actif, tu peux :
- Envoyer des messages depuis l'interface
- Voir les messages entrants en temps réel
- Gérer plusieurs comptes WhatsApp
- Voir les logs détaillés par session

---

## ❌ Problème ?

### **Erreur "Failed to create provision"**
```powershell
docker-compose exec api npx prisma migrate deploy
docker-compose restart api
```

### **Les changements de code ne sont pas pris en compte**
```powershell
.\up.ps1 --build  # Force le rebuild
```

### **Reset complet**
```powershell
.\reset.ps1
.\up.ps1 --build
```

---

Pour plus de détails : [README.md](README.md) | [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md)

