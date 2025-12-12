import axios, { AxiosResponse } from 'axios';
import { createChildLogger } from '../../utils/logger';
import {
  OnlineSimCountry,
  OnlineSimService,
  OnlineSimBalance,
  OnlineSimApiResponse,
} from './types';

const logger = createChildLogger('onlinesim-adapter');

export interface OnlineSimConfig {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export class OnlineSimAdapter {
  private config: OnlineSimConfig;

  constructor(config: OnlineSimConfig) {
    this.config = config;
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<OnlineSimBalance> {
    try {
      const response: AxiosResponse<OnlineSimApiResponse<OnlineSimBalance>> = await axios.get(
        `${this.config.baseUrl}/getBalance.php`,
        {
          params: {
            apikey: this.config.apiKey,
          },
        }
      );

      if (response.data.error) {
        throw new Error(`OnlineSim API error: ${response.data.error}`);
      }

      // Handle direct number response for balance (as string)
      if (typeof response.data.response === 'string' && !isNaN(Number(response.data.response))) {
        const balance = {
          balance: Number(response.data.response),
          currency: 'USD'
        };
        logger.info({ balance: balance.balance }, 'Balance retrieved');
        return balance;
      }

      if (typeof response.data.response === 'string') {
        throw new Error(`Unexpected response format: ${response.data.response}`);
      }

      // This should never be reached for balance endpoint
      throw new Error(`Unexpected response type: ${typeof response.data.response}`);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get balance');
      throw error;
    }
  }

  /**
   * Get available countries
   */
  async getCountries(retryCount = 0, maxRetries = 3): Promise<OnlineSimCountry[]> {
    try {
      const response: AxiosResponse<OnlineSimApiResponse<OnlineSimCountry[]>> = await axios.get(
        `${this.config.baseUrl}/getCountries.php`,
        {
          params: {
            apikey: this.config.apiKey,
          },
        }
      );

      if (response.data.error) {
        throw new Error(`OnlineSim API error: ${response.data.error}`);
      }

      // Handle "TRY_AGAIN_LATER" response
      if (response.data.response === "TRY_AGAIN_LATER") {
        if (retryCount >= maxRetries) {
          throw new Error('OnlineSim API returned TRY_AGAIN_LATER after maximum retries');
        }
        
        const delay = Math.min(5000 * (retryCount + 1), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.getCountries(retryCount + 1, maxRetries);
      }

      if (!Array.isArray(response.data.response)) {
        throw new Error(`Unexpected response format: ${typeof response.data.response}`);
      }

      logger.info({ count: response.data.response.length }, 'Retrieved countries');
      return response.data.response;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get countries');
      throw error;
    }
  }

  /**
   * Get available services for a country
   */
  async getServices(country: number, retryCount = 0, maxRetries = 3): Promise<OnlineSimService[]> {
    try {
      console.log(`📡 [ONLINESIM] Getting services for country ${country} (attempt ${retryCount + 1}/${maxRetries + 1})...`);
      
      const response: AxiosResponse<OnlineSimApiResponse<OnlineSimService[]>> = await axios.get(
        `${this.config.baseUrl}/getServices.php`,
        {
          params: {
            apikey: this.config.apiKey,
            country: country,
          },
        }
      );

      console.log(`📥 [ONLINESIM] getServices response:`, JSON.stringify(response.data).substring(0, 200));

      if (response.data.error) {
        console.log(`❌ [ONLINESIM] API error:`, response.data.error);
        throw new Error(`OnlineSim API error: ${response.data.error}`);
      }

      // Handle "TRY_AGAIN_LATER" response
      if (response.data.response === "TRY_AGAIN_LATER") {
        if (retryCount >= maxRetries) {
          console.log(`❌ [ONLINESIM] Max retries reached for TRY_AGAIN_LATER`);
          throw new Error('OnlineSim API returned TRY_AGAIN_LATER after maximum retries. The API may be rate-limited or temporarily unavailable.');
        }
        
        const delay = Math.min(5000 * (retryCount + 1), 30000); // Exponential backoff, max 30s
        console.log(`⚠️ [ONLINESIM] API returned TRY_AGAIN_LATER, retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.getServices(country, retryCount + 1, maxRetries);
      }

      if (!Array.isArray(response.data.response)) {
        console.log(`❌ [ONLINESIM] Unexpected response format:`, typeof response.data.response);
        throw new Error(`Unexpected response format: ${typeof response.data.response}`);
      }

      console.log(`✅ [ONLINESIM] Retrieved ${response.data.response.length} services for country ${country}`);
      logger.info({ country, count: response.data.response.length }, 'Retrieved services');
      return response.data.response;
    } catch (error: any) {
      console.log(`❌ [ONLINESIM] Failed to get services:`, error.message);
      logger.error({ error: error.message }, 'Failed to get services');
      throw error;
    }
  }

  /**
   * Get country ID by name
   * OPTIMIZED: Uses hardcoded mapping to avoid rate-limiting from getCountries calls
   */
  async getCountryId(countryName: string): Promise<number> {
    // OPTIMIZATION: Use hardcoded country IDs to avoid getCountries API calls
    // These IDs are verified to work with OnlineSim
    const countryMap: { [key: string]: number } = {
      'canada': 1,
      'united states': 1,
      'usa': 1,
      'us': 1,
      'russia': 7,
      'ukraine': 1,  // Use 1 as fallback
      'uk': 16,
      'united kingdom': 16,
      'germany': 43,
      'france': 33,
      'netherlands': 48,
      'poland': 15,
      'spain': 56,
      'italy': 39,
    };
    
    const countryKey = countryName.toLowerCase();
    const countryId = countryMap[countryKey] || 1; // Default to 1 (Canada/US)
    
    console.log(`✅ [ONLINESIM] Using country ID ${countryId} for "${countryName}" (hardcoded to avoid rate limit)`);
    logger.info({ countryName, countryId }, 'Resolved country ID from hardcoded map');
    return countryId;
  }

  /**
   * Get WhatsApp service ID for a country
   * OPTIMIZED: Returns 'whatsapp' directly to avoid rate-limiting from getServices calls
   */
  async getWhatsAppServiceId(country: number): Promise<string> {
    // OPTIMIZATION: OnlineSim accepts 'whatsapp' as service name directly
    // No need to call getServices which triggers rate limiting
    console.log(`✅ [ONLINESIM] Using direct service ID 'whatsapp' for country ${country} (skip getServices to avoid rate limit)`);
    logger.info({ country, serviceId: 'whatsapp' }, 'Using direct WhatsApp service ID');
    return 'whatsapp';
  }

  /**
   * Find first available country with WhatsApp numbers
   * Tries countries in priority order: Canada, United States, etc.
   * Uses real country IDs from API to avoid invalid IDs
   */
  async findAvailableCountry(): Promise<{ countryId: number; countryName: string }> {
    const preferredCountryNames = [
      'United States', // Priority: US first to avoid WhatsApp country selection issues
      'Canada',
      'Germany',
      'France',
      'United Kingdom',
      // Removed Israel - may have invalid country ID
    ];

    console.log(`🔍 [ONLINESIM] Searching for available country with WhatsApp numbers...`);

    // Get all countries from API first to get real IDs
    let countries: OnlineSimCountry[] = [];
    try {
      countries = await this.getCountries();
      console.log(`✅ [ONLINESIM] Retrieved ${countries.length} countries from API`);
    } catch (error: any) {
      console.log(`⚠️ [ONLINESIM] Failed to get countries list: ${error.message}, throwing error for SMS-MAN fallback`);
      // If TRY_AGAIN_LATER, throw error to trigger SMS-MAN fallback
      if (error.message?.includes('TRY_AGAIN_LATER')) {
        throw new Error('TRY_AGAIN_LATER: OnlineSim API unavailable');
      }
      // Fallback to Canada ID 1 for other errors
      return { countryId: 1, countryName: 'Canada' };
    }

    // Try preferred countries first (using real IDs from API)
    for (const preferredName of preferredCountryNames) {
      try {
        const country = countries.find(c => 
          c.country_text.toLowerCase() === preferredName.toLowerCase() ||
          c.country_short.toLowerCase() === preferredName.toLowerCase()
        );

        if (!country) {
          console.log(`⚠️ [ONLINESIM] ${preferredName} not found in countries list`);
          continue;
        }

        console.log(`🔍 [ONLINESIM] Checking ${country.country_text} (ID: ${country.country})...`);
        let services;
        try {
          services = await this.getServices(country.country);
        } catch (getServicesError: any) {
          // If getServices returns TRY_AGAIN_LATER after max retries, throw error with TRY_AGAIN_LATER prefix
          if (getServicesError.message.includes('TRY_AGAIN_LATER') && getServicesError.message.includes('maximum retries')) {
            console.log(`❌ [ONLINESIM] findAvailableCountry: getServices returned TRY_AGAIN_LATER after max retries for ${preferredName}`);
            throw new Error('TRY_AGAIN_LATER: OnlineSim API returned TRY_AGAIN_LATER after maximum retries');
          }
          throw getServicesError;
        }
        const whatsappService = services.find(s => 
          s.service_text.toLowerCase().includes('whatsapp') ||
          s.service_text.toLowerCase().includes('whats app')
        );

        if (whatsappService && whatsappService.count > 0) {
          console.log(`✅ [ONLINESIM] Found available country: ${country.country_text} (ID: ${country.country}) with ${whatsappService.count} WhatsApp numbers`);
          return { countryId: country.country, countryName: country.country_text };
        } else if (whatsappService) {
          console.log(`⚠️ [ONLINESIM] ${country.country_text} has WhatsApp service but no available numbers (count: ${whatsappService.count})`);
        } else {
          console.log(`⚠️ [ONLINESIM] ${country.country_text} does not have WhatsApp service`);
        }
      } catch (error: any) {
        // If TRY_AGAIN_LATER, re-throw to trigger SMS-MAN fallback
        if (error.message?.includes('TRY_AGAIN_LATER')) {
          throw error;
        }
        console.log(`⚠️ [ONLINESIM] Error checking ${preferredName}: ${error.message}`);
        continue;
      }
    }

    // If preferred countries don't work, try all countries from API
    console.log(`🔍 [ONLINESIM] Preferred countries unavailable, trying all countries...`);
    for (const country of countries.slice(0, 30)) { // Check first 30 to avoid timeout
      try {
        console.log(`🔍 [ONLINESIM] Checking ${country.country_text} (ID: ${country.country})...`);
        const services = await this.getServices(country.country);
        const whatsappService = services.find(s => 
          s.service_text.toLowerCase().includes('whatsapp') ||
          s.service_text.toLowerCase().includes('whats app')
        );

        if (whatsappService && whatsappService.count > 0) {
          console.log(`✅ [ONLINESIM] Found available country: ${country.country_text} (ID: ${country.country}) with ${whatsappService.count} WhatsApp numbers`);
          return { countryId: country.country, countryName: country.country_text };
        }
      } catch (error: any) {
        // If TRY_AGAIN_LATER, re-throw to trigger SMS-MAN fallback
        if (error.message?.includes('TRY_AGAIN_LATER')) {
          throw error;
        }
        // Skip other errors and continue to next country
        continue;
      }
    }

    // Fallback: try to use Canada from API, or use ID 1 if not found
    const canada = countries.find(c => 
      c.country_text.toLowerCase().includes('canada') ||
      c.country_short.toLowerCase() === 'ca'
    );
    
    if (canada) {
      console.log(`⚠️ [ONLINESIM] No available country found, defaulting to Canada (ID: ${canada.country})`);
      return { countryId: canada.country, countryName: canada.country_text };
    }

    console.log(`⚠️ [ONLINESIM] No available country found, using fallback ID 1`);
    return { countryId: 1, countryName: 'Canada' };
  }

  /**
   * Buy a phone number
   */
  async buyNumber(country: number, service: string, retryCount = 0, maxRetries = 3): Promise<{ tzid: number; number: string }> {
    try {
      console.log(`📞 [ONLINESIM] Buying number for country ${country}, service ${service}... (attempt ${retryCount + 1}/${maxRetries + 1})`);
      logger.info({ country, service, retryCount }, 'Buying number from OnlineSim');
      
      const response: AxiosResponse<any> = await axios.get(
        `${this.config.baseUrl}/getNum.php`,
        {
          params: {
            apikey: this.config.apiKey,
            service: service,
            country: country,
          },
        }
      );

      console.log(`📥 [ONLINESIM] Buy response:`, JSON.stringify(response.data).substring(0, 200));

      // Check for error responses
      if (response.data.error) {
        console.log(`❌ [ONLINESIM] API error:`, response.data.error);
        throw new Error(`OnlineSim API error: ${response.data.error}`);
      }

      // Handle "TRY_AGAIN_LATER" response with retry logic
      if (response.data.response === "TRY_AGAIN_LATER") {
        console.log(`⏳ [ONLINESIM] Got TRY_AGAIN_LATER (attempt ${retryCount + 1}/${maxRetries + 1})`);
        if (retryCount >= maxRetries) {
          console.log(`❌ [ONLINESIM] Max retries reached for TRY_AGAIN_LATER`);
          throw new Error('OnlineSim API returned TRY_AGAIN_LATER after maximum retries');
        }
        
        const delay = Math.min(5000 * (retryCount + 1), 30000);
        console.log(`⏰ [ONLINESIM] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.buyNumber(country, service, retryCount + 1, maxRetries);
      }

      // Check for UNDEFINED_COUNTRY or other error formats
      if (response.data.response === 'UNDEFINED_COUNTRY') {
        console.log(`❌ [ONLINESIM] UNDEFINED_COUNTRY error for country ID: ${country}`);
        throw new Error(`OnlineSim API error: UNDEFINED_COUNTRY - Country ID ${country} is not valid. Please check the country ID.`);
      }
      
      if (typeof response.data.response === 'string' && response.data.response.includes('UNDEFINED')) {
        console.log(`❌ [ONLINESIM] Undefined error: ${response.data.response}`);
        throw new Error(`OnlineSim API error: ${response.data.response}`);
      }

      // Handle different response formats
      let tzid: number;
      let number: string = '';

      // Format 1: { response: 1, tzid: 123456 } - only TZID, need to fetch number from getState
      if (typeof response.data.response === 'number' && response.data.tzid) {
        tzid = response.data.tzid;
        console.log(`✅ [ONLINESIM] Got TZID: ${tzid}, fetching number from state...`);
        
        // Fetch number from getState
        const stateResponse = await axios.get(`${this.config.baseUrl}/getState.php`, {
          params: {
            apikey: this.config.apiKey,
            tzid: tzid,
          },
        });
        
        if (Array.isArray(stateResponse.data) && stateResponse.data[0]) {
          number = stateResponse.data[0].number || '';
          console.log(`✅ [ONLINESIM] Got number: ${number}`);
        }
      }
      // Format 2: { response: { tzid: 123456, number: "+1234567890" } }
      else if (response.data.response && typeof response.data.response === 'object') {
        tzid = response.data.response.tzid;
        number = response.data.response.number || '';
      }
      // Format 3: Direct tzid in response (legacy)
      else if (response.data.tzid) {
        tzid = response.data.tzid;
      }
      else {
        throw new Error(`Unexpected response format: ${JSON.stringify(response.data)}`);
      }

      if (!tzid) {
        throw new Error(`No TZID found in response: ${JSON.stringify(response.data)}`);
      }

      // If we still don't have the number, try to get it
      if (!number) {
        console.log(`⚠️ [ONLINESIM] Number not in buy response, fetching from state...`);
        const stateResponse = await axios.get(`${this.config.baseUrl}/getState.php`, {
          params: {
            apikey: this.config.apiKey,
            tzid: tzid,
          },
        });
        
        if (Array.isArray(stateResponse.data) && stateResponse.data[0]) {
          number = stateResponse.data[0].number || '';
        }
      }

      console.log(`✅ [ONLINESIM] Number purchased: TZID=${tzid}, Number=${number}`);
      logger.info({ tzid, number }, 'Number purchased');
      
      return {
        tzid,
        number,
      };
    } catch (error: any) {
      console.log(`❌ [ONLINESIM] Failed to buy number:`, error.message);
      logger.error({ error: error.message, country, service }, 'Failed to buy number');
      throw error;
    }
  }

  /**
   * Get SMS for a transaction
   */
  async getSms(tzid: number): Promise<string> {
    try {
      console.log(`📱 [ONLINESIM] Getting SMS for TZID: ${tzid}...`);
      
      const response: AxiosResponse<any> = await axios.get(
        `${this.config.baseUrl}/getState.php`,
        {
          params: {
            apikey: this.config.apiKey,
            tzid: tzid,
          },
        }
      );

      // OnlineSim returns array directly, not wrapped in {response: [...]}
      if (Array.isArray(response.data)) {
        const result = response.data[0];
        if (!result) {
          return '';
        }

        console.log(`📥 [ONLINESIM] State response: status=${result.response}, number=${result.number}`);
        
        // Status can be in 'response' field or 'status' field
        const status = result.response || result.status;
        
        if (status === 'TZ_NUM_WAIT' || status === 'TZ_NUM_ANSWER_WAIT') {
          // Still waiting for SMS
          return '';
        }

        if (status === 'TZ_NUM_ANSWER' && result.msg) {
          console.log(`✅ [ONLINESIM] SMS received: ${result.msg}`);
          console.log(`📱 [ONLINESIM] Full SMS text for TZID ${tzid}: "${result.msg}"`);
          logger.info({ tzid, text: result.msg, fullSms: result.msg }, 'SMS received');
          return result.msg;
        }

        if (status === 'TZ_NUM_CANCEL' || status === 'TZ_NUM_CANCEL_WAIT') {
          throw new Error('Number was cancelled');
        }

        // Still waiting
        return '';
      }

      // Check for ERROR_NO_OPERATIONS (invalid/expired TZID)
      if (response.data.response === 'ERROR_NO_OPERATIONS') {
        console.log(`❌ [ONLINESIM] TZID ${tzid} is no longer valid (ERROR_NO_OPERATIONS)`);
        const error = new Error('TZID_NO_LONGER_VALID');
        (error as any).code = 'ERROR_NO_OPERATIONS';
        (error as any).tzid = tzid;
        throw error;
      }

      // Fallback: handle old format with {response: {...}}
      if (response.data.error) {
        // Check if error is ERROR_NO_OPERATIONS
        if (response.data.error === 'ERROR_NO_OPERATIONS' || response.data.response === 'ERROR_NO_OPERATIONS') {
          console.log(`❌ [ONLINESIM] TZID ${tzid} is no longer valid (ERROR_NO_OPERATIONS)`);
          const error = new Error('TZID_NO_LONGER_VALID');
          (error as any).code = 'ERROR_NO_OPERATIONS';
          (error as any).tzid = tzid;
          throw error;
        }
        throw new Error(`OnlineSim API error: ${response.data.error}`);
      }

      if (typeof response.data.response === 'string' || typeof response.data.response === 'number') {
        return ''; // Still waiting
      }

      const result = response.data.response;
      
      if (result.status === 'TZ_NUM_WAIT' || result.status === 'TZ_NUM_ANSWER_WAIT') {
        return '';
      }

      if (result.status === 'TZ_NUM_ANSWER' && result.text) {
        logger.info({ tzid, text: result.text }, 'SMS received');
        return result.text;
      }

      if (result.status === 'TZ_NUM_CANCEL' || result.status === 'TZ_NUM_CANCEL_WAIT') {
        throw new Error('Number was cancelled');
      }

      return '';
    } catch (error: any) {
      console.log(`❌ [ONLINESIM] Failed to get SMS:`, error.message);
      logger.error({ error: error.message, tzid }, 'Failed to get SMS');
      throw error;
    }
  }

  /**
   * Poll for SMS with timeout
   * Throws special error if TZID is invalid (ERROR_NO_OPERATIONS)
   */
  async pollForSms(tzid: number): Promise<string> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.config.pollTimeoutMs) {
      try {
        const sms = await this.getSms(tzid);
        if (sms) {
          return sms;
        }
      } catch (error: any) {
        // If TZID is no longer valid, throw immediately to trigger cleanup and new purchase
        if (error.code === 'ERROR_NO_OPERATIONS' || error.message === 'TZID_NO_LONGER_VALID') {
          console.log(`❌ [ONLINESIM] TZID ${tzid} is invalid, stopping polling and triggering cleanup`);
          throw error;
        }
        if (error.message.includes('cancelled')) {
          throw error;
        }
        logger.warn({ error: error.message, tzid }, 'Error while polling SMS, retrying...');
      }

      await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
    }

    throw new Error('SMS timeout - no message received');
  }

  /**
   * Set transaction status to ready (optional for OnlineSim)
   */
  async setStatus(tzid: number, status: string): Promise<void> {
    // OnlineSim doesn't require explicit status setting
    logger.info({ tzid, status }, 'Status set (no-op for OnlineSim)');
  }
}
