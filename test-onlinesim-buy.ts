import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.ONLINESIM_API_KEY || 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w';
const BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';

async function testOnlineSimBuy() {
  console.log('🧪 Testing OnlineSim number purchase...\n');
  
  try {
    // Step 1: Get Balance
    console.log('📊 Step 1: Getting balance...');
    const balanceResponse = await axios.get(`${BASE_URL}/getBalance.php`, {
      params: { apikey: API_KEY }
    });
    console.log('✅ Balance:', JSON.stringify(balanceResponse.data, null, 2));
    console.log('');
    
    // Step 2: Try to get services for Canada (ID: 1) directly
    console.log('📱 Step 2: Getting WhatsApp service for Canada (ID: 1)...');
    const servicesResponse = await axios.get(`${BASE_URL}/getService.php`, {
      params: {
        apikey: API_KEY,
        service: 'whatsapp',
        country: 1 // Canada
      }
    });
    
    console.log('📥 Services response:', JSON.stringify(servicesResponse.data, null, 2));
    
    if (servicesResponse.data.error) {
      console.log('❌ Service error:', servicesResponse.data.error);
      throw new Error(`Service error: ${servicesResponse.data.error}`);
    }
    
    // Check if we got a service object or if it's an error
    if (typeof servicesResponse.data.response === 'string' && 
        servicesResponse.data.response === 'TRY_AGAIN_LATER') {
      console.log('⚠️ Service endpoint also returns TRY_AGAIN_LATER');
    } else if (typeof servicesResponse.data.response === 'object') {
      console.log('✅ Got service info:', JSON.stringify(servicesResponse.data.response, null, 2));
    }
    
    console.log('');
    
    // Step 3: Try to buy a number directly
    console.log('📞 Step 3: Attempting to buy a WhatsApp number for Canada...');
    const buyResponse = await axios.get(`${BASE_URL}/getNum.php`, {
      params: {
        apikey: API_KEY,
        service: 'whatsapp',
        country: 1 // Canada
      }
    });
    
    console.log('📥 Buy response:', JSON.stringify(buyResponse.data, null, 2));
    
    if (buyResponse.data.error) {
      console.log('❌ Buy error:', buyResponse.data.error);
    } else if (buyResponse.data.response && typeof buyResponse.data.response === 'object') {
      console.log('✅ Number purchased successfully!');
      console.log('   TZID:', buyResponse.data.response.tzid);
      console.log('   Number:', buyResponse.data.response.number);
    } else if (buyResponse.data.response === 'TRY_AGAIN_LATER') {
      console.log('⚠️ Buy endpoint returned TRY_AGAIN_LATER');
    } else {
      console.log('⚠️ Unexpected response format');
    }
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testOnlineSimBuy();


