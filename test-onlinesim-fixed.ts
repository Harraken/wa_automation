import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.ONLINESIM_API_KEY || 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w';
const BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';

async function testOnlineSim() {
  console.log('🧪 Testing OnlineSim API integration...\n');
  
  try {
    // Test 1: Get Balance
    console.log('📊 Test 1: Getting balance...');
    const balanceResponse = await axios.get(`${BASE_URL}/getBalance.php`, {
      params: { apikey: API_KEY }
    });
    console.log('✅ Balance response:', JSON.stringify(balanceResponse.data, null, 2));
    console.log('');
    
    // Test 2: Get Countries (with retry logic)
    console.log('🌍 Test 2: Getting countries (with retry logic)...');
    let countries: any[] = [];
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        console.log(`   Attempt ${retryCount + 1}/${maxRetries + 1}...`);
        const countriesResponse = await axios.get(`${BASE_URL}/getCountries.php`, {
          params: { apikey: API_KEY }
        });
        
        console.log('   Raw response:', JSON.stringify(countriesResponse.data).substring(0, 200));
        
        if (countriesResponse.data.error) {
          throw new Error(`API error: ${countriesResponse.data.error}`);
        }
        
        if (countriesResponse.data.response === "TRY_AGAIN_LATER") {
          if (retryCount >= maxRetries) {
            throw new Error('Max retries reached for TRY_AGAIN_LATER');
          }
          const delay = Math.min(5000 * (retryCount + 1), 30000);
          console.log(`   ⚠️ TRY_AGAIN_LATER received, waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          continue;
        }
        
        if (Array.isArray(countriesResponse.data.response)) {
          countries = countriesResponse.data.response;
          console.log(`   ✅ Successfully retrieved ${countries.length} countries`);
          break;
        } else {
          throw new Error(`Unexpected response format: ${typeof countriesResponse.data.response}`);
        }
      } catch (error: any) {
        if (retryCount >= maxRetries) {
          throw error;
        }
        console.log(`   ⚠️ Error: ${error.message}, retrying...`);
        retryCount++;
      }
    }
    
    if (countries.length > 0) {
      console.log('\n📋 Sample countries:');
      countries.slice(0, 5).forEach((country: any) => {
        console.log(`   - ${country.country_text} (ID: ${country.country})`);
      });
      console.log('');
    }
    
    // Test 3: Get WhatsApp service for a country (e.g., Canada - ID 1)
    if (countries.length > 0) {
      const canada = countries.find((c: any) => c.country_text?.toLowerCase().includes('canada'));
      if (canada) {
        console.log(`📱 Test 3: Getting WhatsApp service for ${canada.country_text} (ID: ${canada.country})...`);
        const servicesResponse = await axios.get(`${BASE_URL}/getService.php`, {
          params: {
            apikey: API_KEY,
            service: 'whatsapp',
            country: canada.country
          }
        });
        
        console.log('✅ WhatsApp service response:', JSON.stringify(servicesResponse.data, null, 2));
        console.log('');
      }
    }
    
    console.log('✅ All tests completed successfully!');
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testOnlineSim();


