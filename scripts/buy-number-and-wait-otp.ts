/**
 * Script standalone pour acheter un numéro sur SMS-Man et attendre l'OTP
 * 
 * Usage: npx ts-node scripts/buy-number-and-wait-otp.ts [country]
 * 
 * Exemples:
 *   npx ts-node scripts/buy-number-and-wait-otp.ts         # USA par défaut
 *   npx ts-node scripts/buy-number-and-wait-otp.ts canada  # Canada
 *   npx ts-node scripts/buy-number-and-wait-otp.ts germany # Allemagne
 */

import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config();

// Configuration
const SMSMAN_TOKEN = process.env.SMSMAN_TOKEN || '';
const SMSMAN_API_URL = process.env.SMSMAN_API_URL || 'https://api.sms-man.com/control';
const POLL_INTERVAL_MS = parseInt(process.env.SMSMAN_POLL_INTERVAL_MS || '4000', 10);
const POLL_TIMEOUT_MS = parseInt(process.env.SMSMAN_POLL_TIMEOUT_MS || '1800000', 10); // 30 minutes

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

// Client Axios
let client: AxiosInstance;

async function init() {
  if (!SMSMAN_TOKEN) {
    console.error(`${colors.red}❌ ERREUR: SMSMAN_TOKEN non défini dans .env${colors.reset}`);
    console.log(`\nAssurez-vous d'avoir un fichier .env avec:`);
    console.log(`  SMSMAN_TOKEN=votre_token_ici`);
    process.exit(1);
  }

  client = axios.create({
    baseURL: SMSMAN_API_URL,
    timeout: 30000,
  });

  log('🔧', `API URL: ${SMSMAN_API_URL}`, colors.blue);
  log('🔑', `Token: ${SMSMAN_TOKEN.substring(0, 10)}...`, colors.blue);
}

async function getBalance(): Promise<number> {
  const response = await client.get('/get-balance', {
    params: { token: SMSMAN_TOKEN },
  });

  if (response.data && response.data.balance !== undefined) {
    return parseFloat(response.data.balance);
  }
  throw new Error('Impossible de récupérer le solde');
}

interface Country {
  id: string;
  title: string;
  code: string;
}

async function getCountries(): Promise<Map<string, Country>> {
  const response = await client.get('/countries', {
    params: { token: SMSMAN_TOKEN },
  });

  const countries = new Map<string, Country>();
  
  if (response.data && typeof response.data === 'object') {
    Object.values(response.data).forEach((country: any) => {
      countries.set(country.title.toLowerCase(), {
        id: country.id,
        title: country.title,
        code: country.code,
      });
    });
  }

  return countries;
}

async function getWhatsAppApplicationId(): Promise<string> {
  const response = await client.get('/applications', {
    params: { token: SMSMAN_TOKEN },
  });

  if (response.data && typeof response.data === 'object') {
    for (const app of Object.values(response.data) as any[]) {
      if (app.title.toLowerCase().includes('whatsapp') || 
          app.code?.toLowerCase().includes('whatsapp')) {
        return app.id;
      }
    }
  }

  throw new Error('Application WhatsApp non trouvée');
}

async function getPrices(countryId: string, applicationId: string): Promise<{ price: number; count: number } | null> {
  try {
    const response = await client.get('/get-prices', {
      params: {
        token: SMSMAN_TOKEN,
        country_id: countryId,
        application_id: applicationId,
      },
    });

    if (response.data && typeof response.data === 'object') {
      const priceData = Object.values(response.data)[0] as any;
      if (priceData) {
        return {
          price: parseFloat(priceData.cost) / 100, // Convertir centimes en dollars
          count: priceData.count,
        };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function buyNumber(countryId: string, applicationId: string): Promise<{ requestId: string; number: string }> {
  const response = await client.get('/get-number', {
    params: {
      token: SMSMAN_TOKEN,
      country_id: countryId,
      application_id: applicationId,
    },
  });

  const data = response.data;

  if (data.error_code) {
    throw new Error(`Erreur SMS-Man: ${data.error_msg || data.error_code}`);
  }

  if (!data.request_id || !data.number) {
    throw new Error('Réponse invalide de l\'API');
  }

  return {
    requestId: data.request_id.toString(),
    number: data.number,
  };
}

async function getSms(requestId: string): Promise<{ smsCode?: string; status: string }> {
  const response = await client.get('/get-sms', {
    params: {
      token: SMSMAN_TOKEN,
      request_id: requestId,
    },
  });

  const data = response.data;

  if (data.error_code) {
    return { status: 'wait' };
  }

  if (data.sms_code) {
    return { smsCode: data.sms_code, status: 'received' };
  }

  return { status: 'wait' };
}

async function setStatus(requestId: string, status: 'ready' | 'reject' | 'cancel'): Promise<void> {
  await client.get('/set-status', {
    params: {
      token: SMSMAN_TOKEN,
      request_id: requestId,
      status,
    },
  });
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
  console.log(`${colors.bright}${colors.magenta}  📱 SMS-MAN - Achat de numéro et attente OTP${colors.reset}`);
  console.log('='.repeat(60) + '\n');

  await init();

  // Récupérer le pays depuis les arguments (défaut: usa)
  const countryArg = process.argv[2]?.toLowerCase() || 'usa';

  try {
    // 1. Vérifier le solde
    log('💰', 'Vérification du solde...', colors.yellow);
    const balance = await getBalance();
    log('💰', `Solde actuel: $${balance.toFixed(2)}`, colors.green);

    if (balance < 0.1) {
      log('❌', 'Solde insuffisant!', colors.red);
      process.exit(1);
    }

    // 2. Récupérer les pays et trouver celui demandé
    log('🌍', 'Récupération des pays disponibles...', colors.yellow);
    const countries = await getCountries();
    
    // Chercher le pays
    let country: Country | undefined;
    
    // Mappings courants
    const countryMappings: { [key: string]: string[] } = {
      'usa': ['united states', 'usa', 'us'],
      'canada': ['canada', 'ca'],
      'germany': ['germany', 'de', 'deutschland'],
      'uk': ['united kingdom', 'uk', 'england', 'britain'],
      'france': ['france', 'fr'],
    };

    const searchTerms = countryMappings[countryArg] || [countryArg];
    
    for (const term of searchTerms) {
      if (countries.has(term)) {
        country = countries.get(term);
        break;
      }
    }

    // Si pas trouvé, chercher partiellement
    if (!country) {
      for (const [name, c] of countries) {
        if (name.includes(countryArg)) {
          country = c;
          break;
        }
      }
    }

    if (!country) {
      log('❌', `Pays non trouvé: ${countryArg}`, colors.red);
      log('📋', 'Pays disponibles:', colors.yellow);
      const sortedCountries = Array.from(countries.keys()).sort();
      sortedCountries.slice(0, 20).forEach(c => console.log(`    - ${c}`));
      if (sortedCountries.length > 20) {
        console.log(`    ... et ${sortedCountries.length - 20} autres`);
      }
      process.exit(1);
    }

    log('🌍', `Pays sélectionné: ${country.title} (ID: ${country.id})`, colors.green);

    // 3. Récupérer l'ID de l'application WhatsApp
    log('📲', 'Recherche de l\'application WhatsApp...', colors.yellow);
    const whatsappAppId = await getWhatsAppApplicationId();
    log('📲', `Application WhatsApp ID: ${whatsappAppId}`, colors.green);

    // 4. Vérifier le prix et la disponibilité
    log('💵', 'Vérification du prix...', colors.yellow);
    const priceInfo = await getPrices(country.id, whatsappAppId);
    
    if (!priceInfo || priceInfo.count === 0) {
      log('❌', 'Aucun numéro disponible pour ce pays!', colors.red);
      process.exit(1);
    }

    log('💵', `Prix: $${priceInfo.price.toFixed(2)} | Disponibles: ${priceInfo.count} numéros`, colors.green);

    // 5. Acheter le numéro
    log('🛒', `Achat d'un numéro ${country.title} pour WhatsApp...`, colors.bright + colors.yellow);
    const purchase = await buyNumber(country.id, whatsappAppId);
    
    console.log('\n' + '─'.repeat(60));
    log('✅', `NUMÉRO ACHETÉ: +${purchase.number}`, colors.bright + colors.green);
    log('🔢', `Request ID: ${purchase.requestId}`, colors.cyan);
    console.log('─'.repeat(60) + '\n');

    // 6. Attendre l'OTP
    log('⏳', 'En attente du SMS OTP...', colors.yellow);
    log('📝', 'Entrez ce numéro dans WhatsApp pour recevoir le code', colors.cyan);
    console.log('\n');

    const startTime = Date.now();
    let attempt = 0;
    let delay = POLL_INTERVAL_MS;

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      attempt++;
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      
      process.stdout.write(`\r${colors.yellow}⏳ Attente du SMS... (${minutes}:${seconds.toString().padStart(2, '0')}) - Tentative #${attempt}${colors.reset}    `);

      const result = await getSms(purchase.requestId);

      if (result.smsCode) {
        console.log('\n\n' + '═'.repeat(60));
        log('📨', `SMS REÇU!`, colors.bright + colors.green);
        console.log('═'.repeat(60));
        
        const otp = extractOTP(result.smsCode);
        
        console.log(`\n${colors.bright}${colors.magenta}  ╔════════════════════════════════╗${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║                                ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║       CODE OTP: ${colors.green}${otp?.padEnd(6)}${colors.magenta}         ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ║                                ║${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  ╚════════════════════════════════╝${colors.reset}\n`);
        
        log('📱', `Message complet: ${result.smsCode}`, colors.cyan);
        console.log('═'.repeat(60) + '\n');

        // Confirmer la réception
        try {
          await setStatus(purchase.requestId, 'ready');
          log('✅', 'Statut confirmé à SMS-Man', colors.green);
        } catch (e) {
          // Ignorer les erreurs de statut
        }

        process.exit(0);
      }

      await sleep(delay);
      // Backoff exponentiel avec max 20 secondes
      delay = Math.min(delay * 1.2, 20000);
    }

    console.log('\n');
    log('⏰', `Timeout après ${POLL_TIMEOUT_MS / 60000} minutes`, colors.red);
    log('❌', 'Aucun SMS reçu dans le délai imparti', colors.red);
    
    // Annuler le numéro
    try {
      await setStatus(purchase.requestId, 'cancel');
      log('🚫', 'Numéro annulé', colors.yellow);
    } catch (e) {
      // Ignorer
    }

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






