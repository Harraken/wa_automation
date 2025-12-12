import { OnlineSimAdapter } from './src/providers/onlinesim';

async function testOnlineSim() {
  console.log('🧪 Testing OnlineSim Integration...\n');

  const adapter = new OnlineSimAdapter({
    apiKey: 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w',
    baseUrl: 'https://onlinesim.io/api',
    pollIntervalMs: 3000,
    pollTimeoutMs: 180000,
  });

  try {
    // Test 1: Get balance
    console.log('💰 Testing balance...');
    const balance = await adapter.getBalance();
    console.log('✅ Balance:', balance);
    console.log('');

    // Test 2: Get countries
    console.log('🌍 Testing countries...');
    const countries = await adapter.getCountries();
    console.log('Countries response:', JSON.stringify(countries, null, 2));
    console.log(`✅ Found ${Array.isArray(countries) ? countries.length : 'unknown'} countries`);
    if (Array.isArray(countries)) {
      console.log('First 5 countries:', countries.slice(0, 5).map((c: any) => `${c.country_text} (${c.country})`));
    }
    console.log('');

    // Test 3: Get US country ID
    console.log('🇺🇸 Testing US country ID...');
    const usCountryId = await adapter.getCountryId('United States');
    console.log('✅ US Country ID:', usCountryId);
    console.log('');

    // Test 4: Get services for US
    console.log('📱 Testing services for US...');
    const services = await adapter.getServices(usCountryId);
    console.log(`✅ Found ${services.length} services for US`);
    console.log('Services:', services.map(s => `${s.service_text} (${s.service}) - $${s.price} - ${s.count} available`));
    console.log('');

    // Test 5: Get WhatsApp service
    console.log('📲 Testing WhatsApp service...');
    const whatsappService = await adapter.getWhatsAppServiceId(usCountryId);
    console.log('✅ WhatsApp Service ID:', whatsappService);
    console.log('');

    // Test 6: Try to buy a number (if balance is sufficient)
    if (balance.balance > 0.1) {
      console.log('🛒 Testing number purchase...');
      try {
        const numberResult = await adapter.buyNumber(usCountryId, whatsappService);
        console.log('✅ Number purchased:', numberResult);
        console.log('📱 Phone:', numberResult.number);
        console.log('🆔 Transaction ID:', numberResult.tzid);
        console.log('');
        
        console.log('⏳ Waiting 10 seconds before checking SMS...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('📨 Checking for SMS...');
        try {
          const sms = await adapter.getSms(numberResult.tzid);
          if (sms) {
            console.log('✅ SMS received:', sms);
          } else {
            console.log('⏳ No SMS yet, still waiting...');
          }
        } catch (smsError) {
          console.log('⚠️ SMS check error:', smsError);
        }
      } catch (buyError) {
        console.log('❌ Failed to buy number:', buyError);
      }
    } else {
      console.log('⚠️ Insufficient balance to test number purchase');
    }

    console.log('\n🎉 OnlineSim integration test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testOnlineSim();
