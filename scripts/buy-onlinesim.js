const https = require('https');

const API_KEY = '9FgbQsB5338nrQ6-16RAe62X-v22bQEWE-7ZMRed1L-Ba38bkG6hTQb8Yh';
const BASE_URL = 'https://onlinesim.io/api';

function makeRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${API_KEY}`;
    console.log(`📡 ${endpoint}`);
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', e => {
      reject(e);
    });
  });
}

async function main() {
  console.log('\n============================================================');
  console.log('  📱 OnlineSim - Achat de numéro WhatsApp');
  console.log('============================================================\n');
  
  try {
    // 1. Vérifier le solde
    console.log('💰 Vérification du solde...');
    const balance = await makeRequest('getBalance.php');
    console.log(`✅ Solde: $${balance.balance}\n`);
    
    // 2. Acheter un numéro WhatsApp (country=1 = Canada/USA)
    console.log('🛒 Achat d\'un numéro WhatsApp (Canada/USA)...');
    const purchase = await makeRequest('getNum.php?service=whatsapp&country=1');
    
    if (purchase.tzid) {
      // Récupérer le numéro depuis getState
      console.log('📞 Récupération du numéro...');
      const state = await makeRequest(`getState.php?tzid=${purchase.tzid}`);
      const phoneNumber = Array.isArray(state) && state[0] ? state[0].number : 'inconnu';
      
      console.log('\n============================================================');
      console.log(`✅ NUMÉRO ACHETÉ !`);
      console.log(`📱 Numéro: +${phoneNumber}`);
      console.log(`🔢 TZID: ${purchase.tzid}`);
      console.log('============================================================\n');
      
      console.log('⏳ En attente du SMS OTP...');
      console.log('📝 Entrez ce numéro dans WhatsApp pour recevoir le code\n');
      
      // 3. Attendre l'OTP (polling)
      const startTime = Date.now();
      const timeout = 10 * 60 * 1000; // 10 minutes
      let attempt = 0;
      
      while (Date.now() - startTime < timeout) {
        attempt++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        process.stdout.write(`\r⏳ Attente... ${minutes}:${seconds.toString().padStart(2, '0')} - Tentative #${attempt}    `);
        
        const result = await makeRequest(`getState.php?tzid=${purchase.tzid}`);
        
        if (Array.isArray(result) && result[0]) {
          const msg = result[0].msg;
          if (msg) {
            console.log('\n\n============================================================');
            console.log('📨 SMS REÇU !');
            console.log('============================================================');
            
            // Extraire l'OTP
            const otpMatch = msg.match(/(\d{3}-\d{3})/);
            const otp = otpMatch ? otpMatch[1].replace('-', '') : msg.match(/(\d{6})/)?.[1];
            
            if (otp) {
              console.log(`\n  ╔════════════════════════════════╗`);
              console.log(`  ║                                ║`);
              console.log(`  ║       CODE OTP: ${otp}         ║`);
              console.log(`  ║                                ║`);
              console.log(`  ╚════════════════════════════════╝\n`);
            }
            
            console.log(`📱 Message complet: ${msg}`);
            console.log('============================================================\n');
            process.exit(0);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
      }
      
      console.log('\n\n⏰ Timeout - Aucun SMS reçu après 10 minutes');
      process.exit(1);
      
    } else {
      console.log(`❌ Échec de l'achat:`, purchase);
      process.exit(1);
    }
    
  } catch (error) {
    console.log('\n❌ ERREUR:', error.message);
    process.exit(1);
  }
}

main();

