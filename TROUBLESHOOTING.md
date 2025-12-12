# 🔧 Résolution des problèmes

## ❌ Problème : "Pas de logs dans Session Logs"

### **Cause**
La table `session_logs` n'existait pas dans la base de données.

### **Solution**
✅ **RÉSOLU !** La table a été créée. Pour vérifier :

```powershell
docker-compose exec -T postgres psql -U wa_user -d wa_provisioner -c "\d session_logs"
```

Vous devriez voir la structure de la table.

---

## ❌ Problème : "Le deeplink ne fonctionne pas"

### **Cause possible 1 : Session créée AVANT la mise à jour du code**

Les sessions créées avant l'implémentation du deeplink (version 3.1.0) ne l'ont jamais testé.

### **Solution**
1. **Supprimer l'ancienne session** depuis l'interface (bouton "Delete Session")
2. **Lancer un nouveau provisioning** (bouton "Start provisioning")
3. **Observer les logs** dans "Session Logs" - vous devriez voir :
   ```
   ✅ Worker Version: 3.1.0-deeplink-test - Testing deeplink now!
   📤 Sending test message via DEEPLINK (no contact creation)...
   🔗 Deeplink: whatsapp://send?phone=972545879642&text=Hello...
   ✅ Test message sent successfully via deeplink!
   ```

### **Cause possible 2 : Appium est mort après le snapshot**

Le snapshot Docker peut tuer le serveur Appium dans les anciennes sessions.

### **Solution**
Même chose : supprimer la session et en créer une nouvelle.

---

## ❌ Problème : "Appium server not ready after 30000ms"

### **Cause**
Le serveur Appium dans le conteneur Android n'est plus actif.

### **Solution**
La session est inutilisable. Supprimez-la et créez-en une nouvelle.

---

## ❌ Problème : "Failed to create provision"

### **Cause**
Les tables de la base de données n'existent pas.

### **Solution**
```powershell
docker-compose exec api npx prisma migrate deploy
docker-compose restart api
```

---

## ⚠️ Note importante

**Les sessions actuelles ont été créées AVANT l'implémentation du deeplink.**

Pour tester le deeplink :
1. **Supprimer toutes les sessions existantes**
2. **Lancer un NOUVEAU provisioning**
3. **Observer les logs en temps réel**

Le nouveau provisioning va :
- ✅ Créer le compte WhatsApp
- ✅ Envoyer automatiquement un message test via deeplink
- ✅ Afficher tous les logs dans l'interface
- ✅ Marquer la session comme ACTIVE après le test

---

## 📊 Vérifier la version du worker

```powershell
docker-compose logs worker | Select-String "Worker Version" | Select-Object -Last 1
```

Vous devriez voir : `3.2.0-improved-states`

---

## 🔄 Workflow complet

```powershell
# 1. Supprimer les anciennes sessions depuis l'interface

# 2. Vérifier que le worker est à jour
docker-compose logs worker | Select-String "Worker Version"

# 3. Si la version n'est pas 3.1.0-deeplink-test :
.\up.ps1 --build

# 4. Lancer un nouveau provisioning depuis l'interface

# 5. Observer les logs dans "Session Logs" (maintenant disponibles!)
```

---

## 🎯 Logs attendus pendant le provisioning

### **Phase 1 : Provisioning (0-48%)**
```
🚀 Starting WhatsApp automation...
✅ WhatsApp installed successfully
📞 Number purchased: +12498928079
✅ Phone number entered and submitted
```

### **Phase 2 : Injection OTP (48-50%)**
```
🔑 Starting OTP injection process...
✅ OTP injection completed!
✅ SMS code entered and profile setup completed!
```

### **Phase 3 : Complétion du profil (50-85%)** ← NOUVEAU
```
✅ WhatsApp account activated and ready for use
```

### **Phase 4 : Test deeplink (90%)** ← NOUVEAU
```
✅ Worker Version: 3.2.0-improved-states
📤 Testing message delivery via deeplink (no contact creation needed)...
🔗 Using WhatsApp deeplink to open chat with +972545879642...
✅ Test message sent successfully via deeplink!
```

### **Phase 5 : Snapshot (95%)** ← NOUVEAU
```
📸 Creating snapshot of WhatsApp profile...
✅ Snapshot created successfully
```

### **Phase 6 : Activation (100%)**
```
🎉 WhatsApp account is now fully active and ready to use!
```

Si vous ne voyez PAS ces logs, c'est que la session a été créée avant la mise à jour.

---

## 🚀 Test rapide

1. Aller sur http://localhost:5173
2. Cliquer sur "Delete Session" pour chaque session existante
3. Cliquer sur "Start provisioning"
4. Attendre ~3-4 minutes
5. Observer les logs dans l'onglet "Logs"
6. Voir le message test envoyé via deeplink

Le deeplink devrait fonctionner en ~5-10 secondes au lieu de ~40 secondes avec l'ancienne méthode.

