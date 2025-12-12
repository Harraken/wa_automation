import dotenv from 'dotenv';

dotenv.config();

export const config = {
  sessionId: process.env.SESSION_ID || '',
  phoneNumber: process.env.PHONE_NUMBER || '',
  agentToken: process.env.AGENT_TOKEN || '',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  linkToWeb: process.env.LINK_TO_WEB === 'true',
  
  appium: {
    host: process.env.APPIUM_HOST || 'localhost',
    port: parseInt(process.env.APPIUM_PORT || '4723', 10),
  },
  
  whatsapp: {
    packageName: 'com.whatsapp',
    activityName: 'com.whatsapp.Main',
  },
};






