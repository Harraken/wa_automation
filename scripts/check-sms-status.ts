import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const API_KEY = process.env.ONLINESIM_API_KEY || 'D1mdrmkQJJ3tL2q-9PX9m9pa-YWy9Wnyv-t9PNxDra-BVUZ1a37NQnGa8w';
const BASE_URL = process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api';

async function checkSmsStatus(phoneNumber: string) {
  console.log(`🔍 Checking SMS status for number: ${phoneNumber}\n`);

  try {
    // 1. Find the phone number in database
    const phoneNumberRecord = await prisma.phoneNumber.findUnique({
      where: { phone: phoneNumber },
    });

    if (!phoneNumberRecord) {
      console.log(`❌ Number ${phoneNumber} not found in database`);
      console.log(`💡 This number may not have been purchased through the system`);
      return;
    }

    console.log(`✅ Found in database:`);
    console.log(`   Request ID (OnlineSim TZID): ${phoneNumberRecord.requestId || 'N/A'}`);
    console.log(`   Provider: ${phoneNumberRecord.provider}`);
    console.log(`   Is Used: ${phoneNumberRecord.isUsed}`);
    console.log(`   Used At: ${phoneNumberRecord.usedAt || 'Never'}`);

    // 2. Find provision if provisionId exists
    let provision = null;
    if (phoneNumberRecord.provisionId) {
      provision = await prisma.provision.findUnique({
        where: { id: phoneNumberRecord.provisionId },
        select: {
          id: true,
          state: true,
          phone: true,
          requestIdSmsman: true,
        },
      });

      if (provision) {
        console.log(`\n📋 Provision Info:`);
        console.log(`   Provision ID: ${provision.id}`);
        console.log(`   State: ${provision.state}`);
        console.log(`   Phone: ${provision.phone || 'N/A'}`);
        console.log(`   Request ID SMS-MAN: ${provision.requestIdSmsman || 'N/A'}`);
      }
    }

    // 3. Get TZID from requestId (OnlineSim TZID is stored in PhoneNumber.requestId)
    const tzid = phoneNumberRecord.requestId;
    
    if (!tzid) {
      console.log(`\n❌ No TZID found for this number`);
      console.log(`💡 Cannot check SMS status without TZID`);
      return;
    }

    console.log(`\n📡 Checking SMS status via OnlineSim API...`);
    console.log(`   TZID: ${tzid}`);

    // 4. Check SMS status via OnlineSim API
    const response = await axios.get(`${BASE_URL}/getState.php`, {
      params: {
        apikey: API_KEY,
        tzid: tzid,
      },
    });

    console.log(`\n📥 API Response:`);
    console.log(JSON.stringify(response.data, null, 2));

    // 5. Parse response
    if (Array.isArray(response.data) && response.data[0]) {
      const state = response.data[0];
      const status = state.response || state.status;
      
      console.log(`\n📊 Status Summary:`);
      console.log(`   Status: ${status}`);
      console.log(`   Number: ${state.number || 'N/A'}`);
      console.log(`   Country: ${state.country || 'N/A'}`);
      console.log(`   Service: ${state.service || 'N/A'}`);
      console.log(`   Time: ${state.time ? `${state.time}s` : 'N/A'}`);

      if (status === 'TZ_NUM_ANSWER' && state.msg) {
        console.log(`\n✅ SMS RECEIVED!`);
        console.log(`   Message: ${state.msg}`);
      } else if (status === 'TZ_NUM_WAIT' || status === 'TZ_NUM_ANSWER_WAIT') {
        console.log(`\n⏳ Still waiting for SMS...`);
        console.log(`   Status: ${status}`);
        console.log(`\n💡 The number is active and waiting for SMS.`);
        console.log(`   Use WhatsApp to request a verification code for: ${state.number || phoneNumber}`);
      } else if (status === 'TZ_NUM_CANCEL' || status === 'TZ_NUM_CANCEL_WAIT') {
        console.log(`\n❌ Number was cancelled`);
        console.log(`   Status: ${status}`);
      } else {
        console.log(`\n⚠️ Unknown status: ${status}`);
      }
    } else if (response.data.error) {
      console.log(`\n❌ API Error: ${response.data.error}`);
    } else {
      console.log(`\n⚠️ Unexpected response format`);
    }

    // 6. Check OTP logs in database
    if (provision) {
      const otpLogs = await prisma.otpLog.findMany({
        where: { provisionId: provision.id },
        orderBy: { parsedAt: 'desc' },
        take: 5,
      });

      if (otpLogs.length > 0) {
        console.log(`\n📝 Recent OTP Logs (${otpLogs.length}):`);
        otpLogs.forEach((log, index) => {
          console.log(`   ${index + 1}. [${log.parsedAt.toISOString()}]`);
          console.log(`      Raw SMS: ${log.rawSms}`);
          console.log(`      Extracted OTP: ${log.code || 'N/A'}`);
        });
      } else {
        console.log(`\n📝 No OTP logs found in database`);
      }
    }

  } catch (error: any) {
    console.error(`\n❌ Error:`, error.message);
    if (error.response) {
      console.error(`   API Response:`, JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Get phone number from command line argument
const phoneNumber = process.argv[2];

if (!phoneNumber) {
  console.error(`❌ Usage: tsx scripts/check-sms-status.ts <phone_number>`);
  console.error(`   Example: tsx scripts/check-sms-status.ts +12143011077`);
  process.exit(1);
}

// Normalize phone number (remove spaces, ensure + prefix)
const normalizedPhone = phoneNumber.trim().replace(/\s+/g, '');

checkSmsStatus(normalizedPhone);

