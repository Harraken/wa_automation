/**
 * Script standalone pour acheter un numéro sur OnlineSim et attendre l'OTP
 * 
 * Usage: npx ts-node scripts/buy-number-onlinesim.ts [country]
 * 
 * Exemples:
 *   npx ts-node scripts/buy-number-onlinesim.ts           # USA par défaut
 *   npx ts-node scripts/buy-number-onlinesim.ts canada    # Canada
 *   npx ts-node scripts/buy-number-onlinesim.ts germany   # Allemagne
 */

import axios from 'axios';
import dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config();

// Configuration
const ONLINESIM_API_KEY = process.env.ONLINESIM_API_KEY || '9FgbQsB5338nrQ6-16RAe62X-v22bQEWE-7ZMRed1L-Ba38bkG6hTQb8Yh';
const ONLINESIM_BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';
const POLL_INTERVAL_MS = parseInt(process.env.ONLINESIM_POLL_INTERVAL_MS || '3000', 10);
const POLL_TIMEOUT_MS = parseInt(process.env.ONLINESIM_POLL_TIMEOUT_MS || '1800000', 10); // 30 minutes

// Couleurs pour le terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(emoji: string, message: string, color: string = colors.reset) {
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${emoji} ${color}${message}${colors.reset}`);
}

// Mapping des pays vers les IDs OnlineSim
const countryMap: { [key: string]: { id: number; name: string } } = {
  'usa': { id: 1, name: 'United States' },
  'us': { id: 1, name: 'United States' },
  'united states': { id: 1, name: 'United States' },
  'canada': { id: 1, name: 'Canada' }, // Canada et USA partagent le même ID
  'russia': { id: 7, name: 'Russia' },
  'uk': { id: 16, name: 'United Kingdom' },
  'united kingdom': { id: 16, name: 'United Kingdom' },
  'germany': { id: 43, name: 'Germany' },
  'france': { id: 33, name: 'France' },
  'netherlands': { id: 48, name: 'Netherlands' },
  'poland': { id: 15, name: 'Poland' },
  'spain': { id: 56, name: 'Spain' },
  'italy': { id: 39, name: 'Italy' },
  'india': { id: 22, name: 'India' },
  'indonesia': { id: 6, name: 'Indonesia' },
  'brazil': { id: 73, name: 'Brazil' },
  'mexico': { id: 54, name: 'Mexico' },
  'philippines': { id: 4, name: 'Philippines' },
};

async function init() {
  if (!ONLINESIM_API_KEY) {
    console.error(`${colors.red}❌ ERREUR: ONLINESIM_API_KEY non défini dans .env${colors.reset}`);
    console.log(`\nAssurez-vous d'avoir un fichier .env avec:`);
    console.log(`  ONLINESIM_API_KEY=votre_api_key_ici`);
    process.exit(1);
  }

  log('🔧', `API URL: ${ONLINESIM_BASE_URL}`, colors.blue);
  log('🔑', `API Key: ${ONLINESIM_API_KEY.substring(0, 10)}...`, colors.blue);
}

async function getBalance(): Promise<number> {
  const response = await axios.get(`${ONLINESIM_BASE_URL}/getBalance.php`, {
    params: { apikey: ONLINESIM_API_KEY },
  });

  if (response.data.error) {
    throw new Error(`Erreur API: ${response.data.error}`);
  }

  // Le solde peut être dans response ou balance
  if (typeof response.data.response === 'string' && !isNaN(Number(response.data.response))) {
    return Number(response.data.response);
  }
  
  if (response.data.balance !== undefined) {
    return Number(response.data.balance);
  }

  throw new Error('Impossible de récupérer le solde');
}

async function buyNumber(countryId: number): Promise<{ tzid: number; number: string }> {
  log('📞', `Achat d'un numéro (country_id: ${countryId}, service: whatsapp)...`, colors.yellow);
  
  const response = await axios.get(`${ONLINESIM_BASE_URL}/getNum.php`, {
    params: {
      apikey: ONLINESIM_API_KEY,
      service: 'whatsapp',
      country: countryId,
    },
  });

  // Vérifier les erreurs
  if (response.data.error) {
    throw new Error(`Erreur API: ${response.data.error}`);
  }

  if (response.data.response === 'TRY_AGAIN_LATER') {
    throw new Error('API retourne TRY_AGAIN_LATER - réessayez plus tard');
  }

  if (response.data.response === 'UNDEFINED_COUNTRY') {
    throw new Error(`Pays non valide (ID: ${countryId})`);
  }

  // Extraire le TZID
  let tzid: number;
  let number: string = '';

  if (typeof response.data.response === 'number' && response.data.tzid) {
    tzid = response.data.tzid;
  } else if (response.data.response && typeof response.data.response === 'object') {
    tzid = response.data.response.tzid;
    number = response.data.response.number || '';
  } else if (response.data.tzid) {
    tzid = response.data.tzid;
  } else {
    throw new Error(`Réponse inattendue: ${JSON.stringify(response.data)}`);
  }

  // Si pas de numéro, le récupérer via getState
  if (!number) {
    const stateResponse = await axios.get(`${ONLINESIM_BASE_URL}/getState.php`, {
      params: {
        apikey: ONLINESIM_API_KEY,
        tzid: tzid,
      },
    });

    if (Array.isArray(stateResponse.data) && stateResponse.data[0]) {
      number = stateResponse.data[0].number || '';
    }
  }

  return { tzid, number };
}

async function getSms(tzid: number): Promise<{ status: string; message?: string }> {
  const response = await axios.get(`${ONLINESIM_BASE_URL}/getState.php`, {
    params: {
      apikey: ONLINESIM_API_KEY,
      tzid: tzid,
    },
  });

  // OnlineSim retourne un tableau
  if (Array.isArray(response.data)) {
    const result = response.data[0];
    if (!result) {
      return { status: 'wait' };
    }

    const status = result.response || result.status;

    if (status === 'TZ_NUM_WAIT' || status === 'TZ_NUM_ANSWER_WAIT') {
      return { status: 'wait' };
    }

    if (status === 'TZ_NUM_ANSWER' && result.msg) {
      return { status: 'received', message: result.msg };
    }

    if (status === 'TZ_NUM_CANCEL' || status === 'TZ_NUM_CANCEL_WAIT') {
      return { status: 'cancelled' };
    }

    return { status: 'wait' };
  }

  // Erreur ERROR_NO_OPERATIONS
  if (response.data.response === 'ERROR_NO_OPERATIONS') {
    return { status: 'expired' };
  }

  if (response.data.error) {
    throw new Error(`Erreur API: ${response.data.error}`);
  }

  return { status: 'wait' };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractOTP(smsText: string): string | null {
  // Chercher un code à 6 chiffres (format WhatsApp: XXX-XXX ou XXXXXX)
  const match = smsText.match(/(\d{3}-\d{3})/);
  if (match) {
    return match[1].replace('-', '');
  }
  
  // Sinon chercher 6 chiffres consécutifs
  const match2 = smsText.match(/(\d{6})/);
  if (match2) {
    return match2[1];
  }

  return smsText; // Retourner le texte brut si pas de pattern trouvé
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.bright}${colors.magenta}  📱 OnlineSim - Achat de numéro et attente OTP${colors.reset}`);
  console.log('='.repeat(60) + '\n');

  await init();

  // Récupérer le pays depuis les arguments (défaut: usa)
  const countryArg = process.argv[2]?.toLowerCase() || 'usa';

  try {
    // 1. Vérifier le solde
    log('💰', 'Vérification du solde...', colors.yellow);
    const balance = await getBalance();
    log('💰', `Solde actuel: $${balance.toFixed(2)}`, colors.green);

    if (balance < 0.5) {
      log('❌', 'Solde insuffisant!', colors.red);
      process.exit(1);
    }

    // 2. Trouver le pays
    const country = countryMap[countryArg];
    
    if (!country) {
      log('❌', `Pays non trouvé: ${countryArg}`, colors.red);
      log('📋', 'Pays disponibles:', colors.yellow);
      Object.keys(countryMap).forEach(c => console.log(`    - ${c}`));
      process.exit(1);
    }

    log('🌍', `Pays sélectionné: ${country.name} (ID: ${country.id})`, colors.green);

    // 3. Acheter le numéro
    log('🛒', `Achat d'un numéro ${country.name} pour WhatsApp...`, colors.bright + colors.yellow);
    const purchase = await buyNumber(country.id);
    
    console.log('\n' + '─'.repeat(60));
    log('✅', `NUMÉRO ACHETÉ: +${purchase.number}`, colors.bright + colors.green);
    log('🔢', `TZID: ${purchase.tzid}`, colors.cyan);
    console.log('─'.repeat(60) + '\n');

    // 4. Attendre l'OTP
    log('⏳', 'En attente du SMS OTP...', colors.yellow);
    log('📝', 'Entrez ce numéro dans WhatsApp pour recevoir le code', colors.cyan);
    console.log('\n');

    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      attempt++;
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      
      process.stdout.write(`\r${colors.yellow}⏳ Attente du SMS... (${minutes}:${seconds.toString().padStart(2, '0')}) - Tentative #${attempt}${colors.reset}    `);

      const result = await getSms(purchase.tzid);

      if (result.status === 'received' && result.message) {
        console.log('\n\n' + '═'.repeat(60));
        log('📨', `SMS REÇU!`, colors.bright + colors.green);
        console.log('═'.repeat(60));
        
        const otp = extractOTP(result.message);
        
        console.log(`\n${colors.bright}${colors.magenta}  ╔════════════════════════════════╗${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║                                ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║       CODE OTP: ${colors.green}${otp?.padEnd(6)}${colors.magenta}         ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║                                ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ╚════════════════════════════════╝${colors.reset}\n`);
        
        log('📱', `Message complet: ${result.message}`, colors.cyan);
        console.log('═'.repeat(60) + '\n');

        process.exit(0);
      }

      if (result.status === 'cancelled') {
        console.log('\n');
        log('❌', 'Le numéro a été annulé', colors.red);
        process.exit(1);
      }

      if (result.status === 'expired') {
        console.log('\n');
        log('❌', 'Le TZID a expiré', colors.red);
        process.exit(1);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    console.log('\n');
    log('⏰', `Timeout après ${POLL_TIMEOUT_MS / 60000} minutes`, colors.red);
    log('❌', 'Aucun SMS reçu dans le délai imparti', colors.red);
    
    process.exit(1);

  } catch (error: any) {
    console.log('\n');
    log('❌', `ERREUR: ${error.message}`, colors.red);
    
    if (error.response?.data) {
      console.log(`${colors.red}Détails:${colors.reset}`, JSON.stringify(error.response.data, null, 2));
    }
    
    process.exit(1);
  }
}

// Gestion des interruptions
process.on('SIGINT', async () => {
  console.log('\n');
  log('⚠️', 'Interruption détectée...', colors.yellow);
  process.exit(0);
});

main();

