import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.ONLINESIM_API_KEY || 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w';
const BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';

// Test with an existing TZID
const TZID = 175739197; // From logs: +12513035355

async function testSmsReceived() {
  console.log(`🧪 Testing SMS status for TZID: ${TZID}...\n`);
  
  try {
    const response = await axios.get(`${BASE_URL}/getState.php`, {
      params: {
        apikey: API_KEY,
        tzid: TZID,
      },
    });
    
    console.log('📥 Full response:', JSON.stringify(response.data, null, 2));
    
    if (Array.isArray(response.data) && response.data[0]) {
      const state = response.data[0];
      console.log('\n📊 Status Info:');
      console.log(`   Status: ${state.response || state.status}`);
      console.log(`   Number: ${state.number}`);
      console.log(`   Country: ${state.country}`);
      console.log(`   Service: ${state.service}`);
      console.log(`   Time: ${state.time}s`);
      
      if (state.msg) {
        console.log(`\n✅ SMS Received!`);
        console.log(`   Message: ${state.msg}`);
      } else {
        console.log(`\n⏳ Still waiting for SMS...`);
        console.log(`   Status: ${state.response || state.status}`);
        console.log(`\n💡 To trigger SMS, use WhatsApp and request a code for: ${state.number}`);
      }
    } else {
      console.log('⚠️ Unexpected response format');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testSmsReceived();


