import { SmsManAdapter } from './src/providers/smsman';

async function testSmsManCountries() {
  console.log('🌍 Testing SMS-MAN with different countries...\n');

  const adapter = new SmsManAdapter({
    token: 'NvrWEZwLlk6eBsbsDnNikUwgzrl_hqtR',
    apiUrl: 'https://api.sms-man.com/control',
    pollIntervalMs: 4000,
    pollTimeoutMs: 180000,
  });

  try {
    const whatsappAppId = await adapter.getWhatsAppApplicationId();
    console.log('📲 WhatsApp Application ID:', whatsappAppId);
    console.log('');

    // Test different countries
    const countriesToTest = [
      'Kazakhstan',
      'China', 
      'Malaysia',
      'Indonesia',
      'Thailand',
      'Vietnam',
      'Philippines',
      'India',
      'Brazil',
      'Russia'
    ];

    for (const countryName of countriesToTest) {
      try {
        console.log(`🇺🇳 Testing ${countryName}...`);
        const countryId = await adapter.getCountryId(countryName);
        console.log(`   Country ID: ${countryId}`);
        
        // Try to buy a number
        const numberResult = await adapter.buyNumber(countryId, whatsappAppId);
        console.log(`   ✅ SUCCESS! Number: ${numberResult.number}, Request ID: ${numberResult.request_id}`);
        console.log('');
        return; // Stop after first success
      } catch (error: any) {
        console.log(`   ❌ ${countryName}: ${error.message}`);
      }
    }

    console.log('❌ No countries with available WhatsApp numbers found');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testSmsManCountries();



