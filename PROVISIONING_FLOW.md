# 📋 Flow de Provisioning WhatsApp

## 🎯 Ordre logique des étapes (Version 3.2.1)

### **Vue d'ensemble**

```
1. PENDING (0%)
   → Attente du démarrage
   
2. SPAWNING_CONTAINER (10-15%)
   → Création du conteneur Android émulateur
   
3. LAUNCHING_WHATSAPP (20%)
   → Lancement de l'application WhatsApp dans le conteneur
   ⏸️ WhatsApp affiche la page "Enter your phone number"
   
4. BUYING_NUMBER (30%)
   ⚠️ POINT CRITIQUE : On achète le numéro MAINTENANT (quand WhatsApp le demande)
   → Achat du numéro auprès de SMS-MAN ou OnlineSim
   
5. ENTERING_PHONE (35-40%)
   → Entrée du numéro acheté dans WhatsApp
   → Clic sur "Next"
   → Confirmation "Yes"
   
6. WAITING_OTP (42-45%)
   → Attente de réception du SMS avec le code OTP
   
7. INJECTING_OTP (48%)
   → Injection automatique du code OTP reçu
   → Vérification du code par WhatsApp
   
8. COMPLETING_PROFILE (50-85%)
   → Gestion des permissions (contacts, médias) : "Deny"
   → Page "Profile info" : saisie du nom (aléatoire)
   → Page "Add your email" : "Skip"
   → Page "Restore backup" : "Cancel"
   → Vérification que WhatsApp est actif (HomeActivity)
   
9. TESTING_DEEPLINK (90%)
   → Test d'envoi de message via deeplink WhatsApp
   → Envoi automatique d'un message test à +972545879642
   → Validation que le deeplink fonctionne (~5-10 secondes)
   
10. CREATING_SNAPSHOT (95%)
    → Création d'une snapshot Docker du conteneur
    → Sauvegarde de l'état du compte WhatsApp
    
11. ACTIVE (100%)
    → Compte WhatsApp prêt et fonctionnel
    → Disponible pour envoi/réception de messages
```

---

## ⚠️ POINT CRITIQUE : Ordre de BUYING_NUMBER

### **Pourquoi cet ordre ?**

**❌ Ancien ordre (incorrect)** :
```
BUYING_NUMBER (10%) → SPAWNING_CONTAINER → LAUNCHING_WHATSAPP
```
**Problème** : On achetait le numéro AVANT même que WhatsApp soit lancé !

**✅ Nouvel ordre (correct)** :
```
SPAWNING_CONTAINER (10%) → LAUNCHING_WHATSAPP (20%) → BUYING_NUMBER (30%)
```
**Logique** : 
1. On lance WhatsApp
2. WhatsApp affiche la page "Enter your phone number"
3. **À CE MOMENT**, on achète le numéro
4. Puis on entre le numéro acheté

---

## 📊 Correspondance avec les logs

### **Dans l'interface, tu verras :**

#### **Phase 1 : Démarrage (0-20%)**
```
📦 Container created, preparing to launch WhatsApp...
🚀 Launching WhatsApp (number will be purchased when ready)...
```

#### **Phase 2 : Achat du numéro (30%)**
```
📞 WhatsApp reached phone entry screen, purchasing SMS-MAN number now...
✅ SMS-MAN purchase successful: +12498928079
✅ Number purchased: +12498928079 (Country: Canada)
```

#### **Phase 3 : Entrée du numéro (35-40%)**
```
📝 Starting phone number entry process...
✅ Phone number +12498928079 entered and submitted successfully
```

#### **Phase 4 : OTP (42-48%)**
```
📱 SMS received: 899024
🔑 Starting OTP injection process...
✅ OTP injection completed!
```

#### **Phase 5 : Profil (50-85%)**
```
✅ Profile info completed successfully!
✅ Email screen skipped successfully!
✅ WhatsApp activation verified: HomeActivity
✅ WhatsApp account activated and ready for use
```

#### **Phase 6 : Test deeplink (90%)**
```
✅ Worker Version: 3.2.0-improved-states
📤 Testing message delivery via deeplink (no contact creation needed)...
🔗 Using WhatsApp deeplink to open chat with +972545879642...
✅ Test message sent successfully via deeplink!
```

#### **Phase 7 : Snapshot (95%)**
```
📸 Creating snapshot of WhatsApp profile...
✅ Snapshot created successfully
```

#### **Phase 8 : Activation finale (100%)**
```
🎉 WhatsApp account is now fully active and ready to use!
```

---

## 🔄 Callback : buyNumberCallback()

Le système utilise un **callback** pour acheter le numéro au bon moment :

```typescript
const buyNumberCallback = async () => {
  // Appelé par whatsappAutomationService quand WhatsApp affiche la page "Enter phone"
  logger.info('📞 WhatsApp is ready for phone number! Buying number NOW...');
  
  // Achat du numéro
  const buyResult = await smsManAdapter.buyNumber(countryId, applicationId);
  
  return buyResult; // Retourne le numéro acheté
};

// Le callback est passé à l'automation
await whatsappAutomationService.startAutomation({
  // ...
  buyNumberCallback, // ← Sera appelé au bon moment
});
```

**Quand le callback est appelé** :
- WhatsApp affiche la page "Enter your phone number"
- L'automation détecte cet écran (activité `.registration.app.phonenumberentry.RegisterPhone`)
- Le callback est exécuté pour acheter le numéro
- Le numéro acheté est retourné et utilisé immédiatement

---

## 📝 Notes importantes

1. **Un seul achat** : Le callback vérifie si un numéro a déjà été acheté (`if (buyResult)`) pour éviter les achats multiples
2. **Fallback providers** : Si SMS-MAN échoue, le système bascule automatiquement sur OnlineSim
3. **Logs détaillés** : Chaque étape enregistre des logs dans `session_logs` pour le debugging
4. **États synchronisés** : Le frontend affiche toujours l'état réel du provisioning
5. **Deeplink testé** : Chaque compte est testé automatiquement pour valider qu'il peut envoyer des messages

---

## 🎯 Vérifier l'ordre dans les logs

Pour vérifier que l'ordre est correct lors d'un provisioning :

```powershell
# Observer les états en temps réel
docker-compose logs -f worker | Select-String "provision_update|BUYING_NUMBER|LAUNCHING_WHATSAPP"
```

**Tu devrais voir** :
```
state: SPAWNING_CONTAINER (10%)
state: LAUNCHING_WHATSAPP (20%)
state: BUYING_NUMBER (30%)      ← Après LAUNCHING_WHATSAPP !
state: ENTERING_PHONE (35%)
...
```

---

## ✅ Résumé

| Étape | État | Progression | Action |
|-------|------|-------------|--------|
| 1 | PENDING | 0% | Attente |
| 2 | SPAWNING_CONTAINER | 10-15% | Créer conteneur |
| 3 | LAUNCHING_WHATSAPP | 20% | Lancer WhatsApp |
| 4 | **BUYING_NUMBER** | **30%** | **Acheter numéro MAINTENANT** |
| 5 | ENTERING_PHONE | 35-40% | Entrer numéro |
| 6 | WAITING_OTP | 42-45% | Attendre SMS |
| 7 | INJECTING_OTP | 48% | Injecter code |
| 8 | COMPLETING_PROFILE | 50-85% | Setup profil |
| 9 | TESTING_DEEPLINK | 90% | Test message |
| 10 | CREATING_SNAPSHOT | 95% | Snapshot |
| 11 | ACTIVE | 100% | ✅ Prêt ! |

---

**Version** : 3.2.1-fixed-state-order  
**Date** : 2025-11-07

