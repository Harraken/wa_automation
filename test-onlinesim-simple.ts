import { OnlineSimAdapter } from './src/providers/onlinesim/adapter';

const adapter = new OnlineSimAdapter({
  apiKey: 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w',
  baseUrl: 'https://onlinesim.io/api',
  pollIntervalMs: 3000,
  pollTimeoutMs: 180000,
});

async function testOnlineSim() {
  console.log('🧪 Testing OnlineSim Integration...\n');

  try {
    // Test 1: Get Balance
    console.log('📊 Test 1: Getting balance...');
    const balance = await adapter.getBalance();
    console.log('✅ Balance:', balance);
    console.log('');

    // Test 2: Get Countries
    console.log('🌍 Test 2: Getting countries...');
    const countries = await adapter.getCountries();
    console.log(`✅ Found ${countries.length} countries`);
    console.log('Top 5 countries:', countries.slice(0, 5).map(c => ({ name: c.country_text, id: c.country })));
    console.log('');

    // Test 3: Get Country ID for United States
    console.log('🔍 Test 3: Getting country ID for United States...');
    const countryId = await adapter.getCountryId('United States');
    console.log('✅ Country ID for United States:', countryId);
    console.log('');

    // Test 4: Get Services for United States
    console.log('📱 Test 4: Getting services for United States...');
    const services = await adapter.getServices(countryId);
    console.log(`✅ Found ${services.length} services`);
    const whatsappService = services.find(s => 
      s.service_text.toLowerCase().includes('whatsapp') ||
      s.service_text.toLowerCase().includes('whats app')
    );
    if (whatsappService) {
      console.log('✅ WhatsApp service found:', whatsappService);
    } else {
      console.log('❌ WhatsApp service not found');
      console.log('Available services:', services.slice(0, 10).map(s => s.service_text));
    }
    console.log('');

    // Test 5: Get WhatsApp Service ID
    console.log('🔍 Test 5: Getting WhatsApp service ID...');
    try {
      const serviceId = await adapter.getWhatsAppServiceId(countryId);
      console.log('✅ WhatsApp service ID:', serviceId);
      console.log('');
    } catch (error: any) {
      console.log('❌ Error getting WhatsApp service ID:', error.message);
      console.log('');
    }

    // Test 6: Buy Number
    console.log('🛒 Test 6: Attempting to buy a number...');
    try {
      const serviceId = await adapter.getWhatsAppServiceId(countryId);
      const buyResult = await adapter.buyNumber(countryId, serviceId);
      console.log('✅ Number purchased:', buyResult);
      console.log('📞 Number:', buyResult.number);
      console.log('🆔 TZID:', buyResult.tzid);
    } catch (error: any) {
      console.log('❌ Error buying number:', error.message);
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

testOnlineSim();
