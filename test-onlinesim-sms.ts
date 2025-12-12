import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.ONLINESIM_API_KEY || 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w';
const BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';

async function testOnlineSimSms(tzid: number) {
  console.log(`🧪 Testing OnlineSim SMS retrieval for TZID: ${tzid}...\n`);
  
  try {
    // Get SMS status
    console.log('📱 Getting SMS status...');
    const stateResponse = await axios.get(`${BASE_URL}/getState.php`, {
      params: {
        apikey: API_KEY,
        tzid: tzid,
      }
    });
    
    console.log('📥 State response:', JSON.stringify(stateResponse.data, null, 2));
    
    if (stateResponse.data.error) {
      console.log('❌ Error:', stateResponse.data.error);
    } else if (Array.isArray(stateResponse.data.response)) {
      const state = stateResponse.data.response[0];
      console.log('✅ Status:', state.status);
      console.log('   Number:', state.number);
      if (state.msg) {
        console.log('   SMS:', state.msg);
      }
    } else {
      console.log('⚠️ Unexpected response format:', typeof stateResponse.data.response);
    }
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Use the TZID from the previous test
const TZID = 175737154;
testOnlineSimSms(TZID);


