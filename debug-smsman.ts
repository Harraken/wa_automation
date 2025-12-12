import { SmsManAdapter } from './src/providers/smsman';

async function debugSmsMan() {
  console.log('🔍 Debugging SMS-MAN Integration...\n');

  const adapter = new SmsManAdapter({
    token: 'NvrWEZwLlk6eBsbsDnNikUwgzrl_hqtR',
    apiUrl: 'https://api.sms-man.com/control',
    pollIntervalMs: 4000,
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
    console.log(`✅ Found ${countries.length} countries`);
    console.log('First 5 countries:', countries.slice(0, 5).map((c: any) => `${c.country_name} (${c.country_id})`));
    console.log('');

    // Test 3: Get applications
    console.log('📱 Testing applications...');
    const applications = await adapter.getApplications();
    console.log(`✅ Found ${applications.length} applications`);
    console.log('Applications:', applications.map((a: any) => `${a.application_name} (${a.application_id})`));
    console.log('');

    // Test 4: Get WhatsApp application ID
    console.log('📲 Testing WhatsApp application...');
    const whatsappAppId = await adapter.getWhatsAppApplicationId();
    console.log('✅ WhatsApp Application ID:', whatsappAppId);
    console.log('');

    // Test 5: Get US country ID
    console.log('🇺🇸 Testing US country ID...');
    const usCountryId = await adapter.getCountryId('USA');
    console.log('✅ US Country ID:', usCountryId);
    console.log('');

    // Test 6: Get prices for US + WhatsApp
    console.log('💰 Testing prices for US + WhatsApp...');
    try {
      const prices = await adapter.getPrices(usCountryId, whatsappAppId);
      console.log('✅ Prices:', prices);
    } catch (priceError) {
      console.log('❌ Price error:', priceError);
    }
    console.log('');

    // Test 7: Try to buy a number
    console.log('🛒 Testing number purchase...');
    try {
      const numberResult = await adapter.buyNumber(usCountryId, whatsappAppId);
      console.log('✅ Number purchased:', numberResult);
      console.log('📱 Phone:', numberResult.number);
      console.log('🆔 Request ID:', numberResult.request_id);
    } catch (buyError) {
      console.log('❌ Failed to buy number:', buyError);
      
      // Try with different country
      console.log('\n🔄 Trying with different country...');
      try {
        const germanyId = await adapter.getCountryId('Germany');
        console.log('🇩🇪 Germany Country ID:', germanyId);
        
        const numberResult2 = await adapter.buyNumber(germanyId, whatsappAppId);
        console.log('✅ Number purchased in Germany:', numberResult2);
      } catch (buyError2) {
        console.log('❌ Failed to buy number in Germany:', buyError2);
      }
    }

    console.log('\n🎉 SMS-MAN debug completed!');

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugSmsMan();



