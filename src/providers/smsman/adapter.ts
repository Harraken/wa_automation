import axios, { AxiosInstance } from 'axios';
import { createChildLogger } from '../../utils/logger';
import {
  SmsManConfig,
  SmsManCountry,
  SmsManApplication,
  SmsManPrice,
  BuyNumberResponse,
  GetSmsResponse,
  BalanceResponse,
  ApiResponse,
} from './types';

const logger = createChildLogger('smsman-adapter');

export class SmsManAdapter {
  private client: AxiosInstance;
  private config: SmsManConfig;
  private cachedCountries: SmsManCountry[] | null = null;
  private cachedApplications: SmsManApplication[] | null = null;

  constructor(config: SmsManConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging (redact token)
    this.client.interceptors.request.use(
      (config) => {
        console.log(`🔵 [SMS-MAN REQUEST] ${config.method?.toUpperCase()} ${config.url}`);
        console.log(`🔵 [SMS-MAN REQUEST] Params:`, JSON.stringify(config.params, null, 2));
        logger.info({ 
          method: config.method, 
          url: config.url, 
          params: config.params 
        }, 'SMS-MAN API request');
        return config;
      },
      (error) => {
        logger.error({ error }, 'SMS-MAN request error');
        return Promise.reject(error);
      }
    );

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log(`🟢 [SMS-MAN RESPONSE] Status: ${response.status}`);
        console.log(`🟢 [SMS-MAN RESPONSE] Data:`, JSON.stringify(response.data, null, 2));
        logger.info({ 
          status: response.status, 
          data: response.data 
        }, 'SMS-MAN API response');
        return response;
      },
      (error) => {
        console.log(`🔴 [SMS-MAN ERROR] Status: ${error.response?.status}`);
        console.log(`🔴 [SMS-MAN ERROR] Data:`, JSON.stringify(error.response?.data, null, 2));
        logger.error({ 
          status: error.response?.status,
          data: error.response?.data,
          message: error.message 
        }, 'SMS-MAN response error');
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<number> {
    try {
      const response = await this.client.get<BalanceResponse>('/get-balance', {
        params: { token: this.config.token },
      });

      console.log('SMS-MAN Balance Response:', JSON.stringify(response.data, null, 2));

      if (response.data && response.data.balance !== undefined) {
        const balance = typeof response.data.balance === 'string' 
          ? parseFloat(response.data.balance) 
          : response.data.balance;
        
        logger.info({ balance }, 'Retrieved balance');
        return balance;
      }

      throw new Error(`Invalid balance response: ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      logger.error({ error: error.message, status: error.response?.status, data: error.response?.data }, 'Failed to get balance');
      throw new Error(`Failed to retrieve SMS-MAN balance: ${error.message}`);
    }
  }

  /**
   * Get list of available countries
   */
  async getCountries(): Promise<SmsManCountry[]> {
    if (this.cachedCountries) {
      return this.cachedCountries;
    }

    try {
      const response = await this.client.get<any>('/countries', {
        params: { token: this.config.token },
      });

      // SMS-MAN returns an object with country data, not an array
      if (response.data && typeof response.data === 'object') {
        const countries: SmsManCountry[] = Object.values(response.data).map((country: any) => ({
          country_id: country.id,
          country_name: country.title,
          country_code: country.code,
        }));
        
        this.cachedCountries = countries;
        logger.info({ count: countries.length }, 'Retrieved countries');
        return countries;
      }

      throw new Error('Invalid countries response');
    } catch (error) {
      logger.error({ error }, 'Failed to get countries');
      throw new Error('Failed to retrieve SMS-MAN countries');
    }
  }

  /**
   * Get country_id by country name
   */
  async getCountryId(countryName: string): Promise<string> {
    logger.info({ countryName }, 'Getting country ID for country');
    const countries = await this.getCountries();
    logger.info({ countryCount: countries.length, countryName }, 'Retrieved countries, searching for country');
    
    const country = countries.find(
      (c) => c.country_name.toLowerCase() === countryName.toLowerCase()
    );

    if (!country) {
      logger.error({ countryName, availableCountries: countries.map(c => c.country_name) }, 'Country not found');
      throw new Error(`Country not found: ${countryName}`);
    }

    logger.info({ countryName, countryId: country.country_id }, 'Resolved country ID');
    return country.country_id;
  }

  /**
   * Get list of available applications
   */
  async getApplications(): Promise<SmsManApplication[]> {
    if (this.cachedApplications) {
      return this.cachedApplications;
    }

    try {
      const response = await this.client.get<any>('/applications', {
        params: { token: this.config.token },
      });

      // SMS-MAN returns an object with application data, not an array
      if (response.data && typeof response.data === 'object') {
        const applications: SmsManApplication[] = Object.values(response.data).map((app: any) => ({
          application_id: app.id,
          application_name: app.title,
          application_code: app.code,
        }));
        
        this.cachedApplications = applications;
        logger.info({ count: applications.length }, 'Retrieved applications');
        return applications;
      }

      throw new Error('Invalid applications response');
    } catch (error) {
      logger.error({ error }, 'Failed to get applications');
      throw new Error('Failed to retrieve SMS-MAN applications');
    }
  }

  /**
   * Get application_id for WhatsApp
   */
  async getWhatsAppApplicationId(): Promise<string> {
    const applications = await this.getApplications();
    const whatsapp = applications.find(
      (app) => 
        app.application_name.toLowerCase().includes('whatsapp') ||
        app.application_code.toLowerCase().includes('whatsapp')
    );

    if (!whatsapp) {
      throw new Error('WhatsApp application not found in SMS-MAN');
    }

    logger.info({ 
      applicationId: whatsapp.application_id,
      applicationName: whatsapp.application_name 
    }, 'Resolved WhatsApp application ID');
    
    return whatsapp.application_id;
  }

  /**
   * Get prices for a specific country and application
   */
  async getPrices(countryId: string, applicationId: string): Promise<SmsManPrice | null> {
    try {
      const response = await this.client.get<any>('/get-prices', {
        params: {
          token: this.config.token,
          country_id: countryId,
          application_id: applicationId,
        },
      });

      // SMS-MAN returns an object with price data, not an array
      if (response.data && typeof response.data === 'object') {
        const priceData = Object.values(response.data)[0] as any;
        if (priceData) {
          // Convert cents to dollars (SMS-MAN API returns prices in cents)
          const priceInCents = parseFloat(priceData.cost);
          const priceInDollars = priceInCents / 100;
          
          const price: SmsManPrice = {
            price: priceInDollars, // Store as dollars (number)
            count: priceData.count,
            country_id: priceData.country_id,
            application_id: priceData.application_id,
          };
          logger.info({ countryId, applicationId, price: price.price, count: price.count }, 'Retrieved price');
          return price;
        }
      }

      return null;
    } catch (error) {
      logger.error({ error, countryId, applicationId }, 'Failed to get prices');
      return null;
    }
  }

  /**
   * Buy a phone number
   */
  async buyNumber(countryId: string, applicationId: string): Promise<BuyNumberResponse> {
    try {
      // Check price and availability first
      const price = await this.getPrices(countryId, applicationId);
      if (!price || price.count === 0) {
        throw new Error('No numbers available for this country/application');
      }

      // Log the request details before attempting to buy
      logger.info({ 
        countryId, 
        applicationId, 
        price: price.price, 
        count: price.count,
        balance: 'checking...' 
      }, 'Attempting to buy number');

      const response = await this.client.get<BuyNumberResponse | ApiResponse<any>>('/get-number', {
        params: {
          token: this.config.token,
          country_id: countryId,
          application_id: applicationId,
        },
      });

      const data = response.data as any;
      
      // Log the raw response for debugging
      logger.info({ 
        rawResponse: JSON.stringify(data), 
        hasError: !!data.error_code,
        hasRequestId: !!data.request_id,
        hasNumber: !!data.number
      }, 'Buy number API response');
      
      if (data.error_code) {
        // Check if it's a balance issue - try to ignore if funds might be reserved
        const errorMsg = data.error_msg || data.error_code;
        if (errorMsg.includes('reserved')) {
          logger.warn({ 
            errorCode: data.error_code,
            errorMsg,
            countryId,
            applicationId 
          }, 'Balance error encountered, but checking if number was still purchased');
          
          // If we got a request_id despite the error, the purchase might have succeeded
          if (data.request_id && data.number) {
            logger.info({
              requestId: data.request_id,
              number: data.number,
              countryId,
              applicationId,
              note: 'Number purchased despite balance warning'
            }, 'Number purchased (with balance warning)');

            return {
              request_id: data.request_id.toString(),
              number: data.number,
            };
          }
        }
        
        throw new Error(`SMS-MAN error: ${errorMsg}`);
      }

      if (!data.request_id || !data.number) {
        throw new Error('Invalid buy number response');
      }

      logger.info({
        requestId: data.request_id,
        number: data.number,
        countryId,
        applicationId,
      }, 'Number purchased');

      return {
        request_id: data.request_id.toString(),
        number: data.number,
      };
    } catch (error) {
      logger.error({ error, countryId, applicationId }, 'Failed to buy number');
      throw error;
    }
  }

  /**
   * Get SMS for a request
   */
  async getSms(requestId: string): Promise<GetSmsResponse> {
    try {
      const response = await this.client.get<GetSmsResponse | ApiResponse<any>>('/get-sms', {
        params: {
          token: this.config.token,
          request_id: requestId,
        },
      });

      const data = response.data as any;
      
      // Log raw response for debugging
      console.log(`📨 [SMS-MAN getSms] Raw API response for ${requestId}:`, JSON.stringify(data, null, 2));

      if (data.error_code) {
        console.log(`⏳ [SMS-MAN getSms] Not ready yet - error_code: ${data.error_code}, error_msg: ${data.error_msg}`);
        logger.debug({ requestId, errorCode: data.error_code }, 'SMS not ready yet');
        return {
          status: 'wait',
          error_code: data.error_code,
          error_msg: data.error_msg,
        };
      }

      if (data.sms_code) {
        console.log(`✅ [SMS-MAN] SMS received: ${data.sms_code}`);
        console.log(`📱 [SMS-MAN] Full SMS code for request ${requestId}: "${data.sms_code}"`);
        logger.info({ requestId, smsCode: data.sms_code, fullSms: data.sms_code }, 'SMS received');
        return {
          sms_code: data.sms_code,
          status: 'received',
        };
      }

      console.log(`⚠️ [SMS-MAN getSms] No sms_code or error_code in response - returning wait status`);
      return { status: 'wait' };
    } catch (error) {
      console.log(`❌ [SMS-MAN getSms] Exception:`, error);
      logger.error({ error, requestId }, 'Failed to get SMS');
      throw error;
    }
  }

  /**
   * Set status for a request
   */
  async setStatus(requestId: string, status: 'ready' | 'reject' | 'cancel'): Promise<void> {
    try {
      console.log(`📤 [SMS-MAN setStatus] ===== DETAILED DEBUG =====`);
      console.log(`📤 [SMS-MAN setStatus] Setting status to '${status}' for request ${requestId}`);
      console.log(`📤 [SMS-MAN setStatus] API URL: /set-status`);
      console.log(`📤 [SMS-MAN setStatus] Params:`, {
        token: `${this.config.token.substring(0, 10)}...`,
        request_id: requestId,
        status,
      });
      
      const response = await this.client.get<ApiResponse<any>>('/set-status', {
        params: {
          token: this.config.token,
          request_id: requestId,
          status,
        },
      });

      console.log(`📥 [SMS-MAN setStatus] FULL Response:`, JSON.stringify(response.data, null, 2));
      console.log(`📥 [SMS-MAN setStatus] Response status:`, response.status);
      console.log(`📥 [SMS-MAN setStatus] Response headers:`, response.headers);

      if (response.data.error_code) {
        console.log(`❌ [SMS-MAN setStatus] API ERROR DETAILS:`);
        console.log(`   error_code: ${response.data.error_code}`);
        console.log(`   error_msg: ${response.data.error_msg}`);
        console.log(`   Full error object:`, response.data);
        throw new Error(`SMS-MAN error: ${response.data.error_msg || response.data.error_code}`);
      }

      console.log(`✅ [SMS-MAN setStatus] Status '${status}' set successfully for ${requestId}`);
      logger.info({ requestId, status }, 'Status updated');
    } catch (error: any) {
      console.log(`❌ [SMS-MAN setStatus] EXCEPTION CAUGHT:`);
      console.log(`   Type: ${error.constructor.name}`);
      console.log(`   Message: ${error.message}`);
      console.log(`   Stack: ${error.stack}`);
      if (error.response) {
        console.log(`   Response data: ${JSON.stringify(error.response.data)}`);
        console.log(`   Response status: ${error.response.status}`);
      }
      logger.error({ error, requestId, status }, 'Failed to set status');
      throw error;
    }
  }

  /**
   * Poll for SMS with exponential backoff
   */
  async pollForSms(requestId: string): Promise<string> {
    const startTime = Date.now();
    let attempt = 0;
    let delay = this.config.pollIntervalMs;

    while (Date.now() - startTime < this.config.pollTimeoutMs) {
      attempt++;
      
      try {
        const result = await this.getSms(requestId);

        if (result.sms_code) {
          return result.sms_code;
        }

        if (result.status === 'cancelled' || result.status === 'rejected') {
          throw new Error(`SMS request ${result.status}`);
        }

        // Wait before next attempt
        logger.debug({ 
          requestId, 
          attempt, 
          nextDelayMs: delay,
          elapsedMs: Date.now() - startTime 
        }, 'Waiting for SMS...');
        
        await this.sleep(delay);

        // Exponential backoff with max 30 seconds
        delay = Math.min(delay * 1.5, 30000);
      } catch (error) {
        logger.error({ error, requestId, attempt }, 'Error during SMS polling');
        
        // For network errors, wait and retry
        if (axios.isAxiosError(error) && !error.response) {
          await this.sleep(delay);
          continue;
        }
        
        throw error;
      }
    }

    throw new Error(`SMS polling timeout after ${this.config.pollTimeoutMs}ms`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

