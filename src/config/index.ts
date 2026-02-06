import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  database: {
    url: process.env.DATABASE_URL || 'postgresql://wa_user:wa_password@postgres:5432/wa_provisioner',
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  agent: {
    authSecret: process.env.AGENT_AUTH_SECRET || 'dev-agent-secret-change-in-production',
  },
  
    smsMan: {
      token: process.env.SMSMAN_TOKEN || '',
      apiUrl: process.env.SMSMAN_API_URL || 'https://api.sms-man.com/control',
      pollIntervalMs: parseInt(process.env.SMSMAN_POLL_INTERVAL_MS || '4000', 10),
      pollTimeoutMs: parseInt(process.env.SMSMAN_POLL_TIMEOUT_MS || '1800000', 10),
      defaultCountry: process.env.SMSMAN_DEFAULT_COUNTRY || 'Canada',
    },

  onlinesim: {
    apiKey: process.env.ONLINESIM_API_KEY || '',
    baseUrl: process.env.ONLINESIM_BASE_URL || 'https://onlinesim.io/api',
    pollIntervalMs: parseInt(process.env.ONLINESIM_POLL_INTERVAL_MS || '3000', 10),
    pollTimeoutMs: parseInt(process.env.ONLINESIM_POLL_TIMEOUT_MS || '180000', 10),
    defaultCountry: process.env.ONLINESIM_DEFAULT_COUNTRY || 'Canada',
  },
  
  emulator: {
    image: process.env.EMULATOR_IMAGE || 'budtmo/docker-android',
    baseVncPort: parseInt(process.env.EMULATOR_BASE_VNC_PORT || '6080', 10),
    baseAppiumPort: parseInt(process.env.EMULATOR_BASE_APPIUM_PORT || '4723', 10),
    baseAdbPort: parseInt(process.env.EMULATOR_BASE_ADB_PORT || '5555', 10),
  },
  
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    path: process.env.STORAGE_PATH || path.join(process.cwd(), 'data', 'snapshots'),
    snapshotFormat: process.env.SNAPSHOT_FORMAT || 'tar.gz',
  },
  
  playwright: {
    enabled: process.env.PLAYWRIGHT_ENABLED === 'true',
    image: process.env.PLAYWRIGHT_IMAGE || 'mcr.microsoft.com/playwright:v1.40.0-focal',
  },
  
  features: {
    linkToWebDefault: process.env.LINK_TO_WEB_DEFAULT === 'true',
    ocrEnabled: process.env.OCR_ENABLED === 'true',
  },
  
  monitoring: {
    promPort: parseInt(process.env.PROM_PORT || '9091', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  
  docker: {
    network: process.env.DOCKER_NETWORK || 'wa-provisioner-network',
  },
  
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'change_this_password',
  },
  
  rateLimit: {
    provisionPerHour: parseInt(process.env.PROVISION_RATE_LIMIT_PER_HOUR || '100', 10),
  },
};

// Validate required config
export function validateConfig(): void {
  const errors: string[] = [];
  
  // Only require SMSMAN_TOKEN in production
  if (config.env === 'production' && (!config.smsMan.token || config.smsMan.token === 'YOUR_SMSMAN_TOKEN_HERE')) {
    errors.push('SMSMAN_TOKEN is required in production. Get it from https://sms-man.com/');
  }
  
  if (config.jwt.secret === 'dev-secret-change-in-production' && config.env === 'production') {
    errors.push('JWT_SECRET must be changed in production');
  }
  
  if (config.agent.authSecret === 'dev-agent-secret-change-in-production' && config.env === 'production') {
    errors.push('AGENT_AUTH_SECRET must be changed in production');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

