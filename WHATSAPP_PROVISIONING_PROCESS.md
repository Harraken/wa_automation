# Processus de Provisioning WhatsApp

## Vue d'ensemble

Ce système **ne peut pas envoyer de SMS ni créer de comptes WhatsApp via API**. Il automatise la réception des codes SMS et l'injection dans WhatsApp via un émulateur Android.

---

## 📡 APIs utilisées pour recevoir les SMS

### 1. OnlineSim (Fournisseur primaire)

**Documentation**: https://onlinesim.io/openapi_docs/Onlinesim-API-UN/info

**Endpoints**:
```bash
# Obtenir le solde
GET https://onlinesim.io/api/getBalance.php?apikey=XXX

# Liste des pays disponibles
GET https://onlinesim.io/api/getFreeCountryList.php?apikey=XXX

# Liste des services (WhatsApp, etc.)
GET https://onlinesim.io/api/getServiceList.php?country=1&apikey=XXX

# Acheter un numéro
GET https://onlinesim.io/api/getNum.php?country=1&service=whatsapp&apikey=XXX

# Récupérer le SMS (polling)
GET https://onlinesim.io/api/getState.php?tzid=175739642&apikey=XXX
```

**Exemple de réponse pour `getNum.php`**:
```json
{
  "response": 1,
  "tzid": 175739642
}
```

**Exemple de réponse pour `getState.php` (SMS reçu)**:
```json
[
  {
    "response": 1,
    "msg": "Your WhatsApp code: 123-456",
    "tzid": 175739642,
    "status": "TZ_NUM_ANSWER"
  }
]
```

### 2. SMS-MAN (Fournisseur de secours)

**Documentation**: https://sms-man.com/api

**Endpoints**:
```bash
# Obtenir le solde
GET https://api.sms-man.com/control/get-balance?token=XXX

# Liste des pays
GET https://api.sms-man.com/control/countries?token=XXX

# Liste des applications (WhatsApp = application_id=6)
GET https://api.sms-man.com/control/applications?token=XXX

# Acheter un numéro
GET https://api.sms-man.com/control/get-number?token=XXX&country_id=13&application_id=6

# Récupérer le SMS (polling)
GET https://api.sms-man.com/control/get-sms?token=XXX&request_id=XXX
```

**Exemple de réponse pour `get-number`**:
```json
{
  "request_id": 779988658,
  "application_id": 6,
  "country_id": 13,
  "number": "4915510170468"
}
```

---

## 🔄 Processus de création de compte WhatsApp

### Étapes automatisées

1. **Achat d'un numéro** via OnlineSim ou SMS-MAN
   - Le système achète un numéro de téléphone réel (ex: +15717262102)

2. **Création d'un émulateur Android** (Docker)
   - Lancement d'un conteneur `budtmo/docker-android`
   - Accès VNC: `http://localhost:5901/vnc.html`

3. **Attente du SMS de vérification**
   - Le système poll les APIs OnlineSim/SMS-MAN toutes les 5 secondes
   - WhatsApp envoie automatiquement un SMS au numéro acheté
   - Le service SMS récupère le SMS et le renvoie via API

4. **Extraction du code OTP** du SMS
   - Format: "Your WhatsApp code: 123-456" ou "123456"
   - Le système extrait: `123456`

5. **Injection du code dans WhatsApp** (via agent/Appium)
   - L'agent Android ouvre WhatsApp dans l'émulateur
   - Entre le code OTP récupéré
   - Complète l'inscription automatiquement

6. **Création de la session WhatsApp**
   - Le compte WhatsApp est créé et prêt à l'emploi
   - La session est sauvegardée pour réutilisation

### Processus manuel (si l'agent ne fonctionne pas)

Si l'agent automatique n'est pas installé dans l'émulateur:

1. Accéder à l'émulateur via VNC: `http://localhost:5901/vnc.html`
2. Installer WhatsApp depuis Google Play Store
3. Ouvrir WhatsApp
4. Entrer le numéro: `+15717262102`
5. WhatsApp demande le code de vérification
6. Le système récupère automatiquement le code via OnlineSim/SMS-MAN
7. Entrer le code manuellement dans WhatsApp

---

## 📝 Exemple de code complet

### Récupérer un SMS via OnlineSim

```typescript
// 1. Acheter un numéro
const buyResponse = await axios.get('https://onlinesim.io/api/getNum.php', {
  params: {
    apikey: 'VOTRE_API_KEY',
    country: 1, // USA
    service: 'whatsapp'
  }
});
// Réponse: { response: 1, tzid: 175739642 }

// 2. Poller pour le SMS (toutes les 5 secondes, max 30 minutes)
const tzid = buyResponse.data.tzid;
let smsReceived = false;
let timeout = Date.now() + (30 * 60 * 1000); // 30 minutes

while (!smsReceived && Date.now() < timeout) {
  const stateResponse = await axios.get('https://onlinesim.io/api/getState.php', {
    params: {
      apikey: 'VOTRE_API_KEY',
      tzid: tzid
    }
  });
  
  // Si le SMS est reçu
  if (stateResponse.data[0]?.status === 'TZ_NUM_ANSWER') {
    const smsText = stateResponse.data[0].msg; // "Your WhatsApp code: 123-456"
    const otpCode = smsText.match(/(\d{3}-\d{3})/)?.[0].replace('-', '');
    console.log('Code OTP:', otpCode); // "123456"
    smsReceived = true;
  } else {
    await sleep(5000); // Attendre 5 secondes
  }
}
```

### Récupérer un SMS via SMS-MAN

```typescript
// 1. Acheter un numéro
const buyResponse = await axios.get('https://api.sms-man.com/control/get-number', {
  params: {
    token: 'VOTRE_TOKEN',
    country_id: 13, // Canada
    application_id: 6 // WhatsApp
  }
});
// Réponse: { request_id: 779988658, number: "4915510170468" }

// 2. Poller pour le SMS
const requestId = buyResponse.data.request_id;
let smsReceived = false;
let timeout = Date.now() + (30 * 60 * 1000);

while (!smsReceived && Date.now() < timeout) {
  const smsResponse = await axios.get('https://api.sms-man.com/control/get-sms', {
    params: {
      token: 'VOTRE_TOKEN',
      request_id: requestId
    }
  });
  
  // Si le SMS est reçu
  if (smsResponse.data.sms) {
    const smsText = smsResponse.data.sms;
    const otpCode = smsText.match(/(\d{3}-\d{3})/)?.[0].replace('-', '');
    console.log('Code OTP:', otpCode);
    smsReceived = true;
  } else {
    await sleep(5000);
  }
}
```

---

## ⚠️ Limitations importantes

1. **Pas d'envoi de SMS**: Le système ne peut PAS envoyer de SMS à d'autres numéros
2. **Pas d'API WhatsApp**: On ne peut pas créer un compte WhatsApp via API officielle
3. **Automation uniquement**: Le système automatise uniquement la réception de SMS et l'injection dans WhatsApp
4. **Émulateur requis**: WhatsApp doit être utilisé dans un émulateur Android pour automatiser l'entrée du code

---

## 🔗 Ressources

- **OnlineSim API**: https://onlinesim.io/openapi_docs/Onlinesim-API-UN/info
- **SMS-MAN API**: https://sms-man.com/api
- **WhatsApp Business API**: https://developers.facebook.com/docs/whatsapp (pour envoyer des messages via l'API officielle, mais nécessite une approbation)


