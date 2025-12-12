import axios from 'axios';
import { SmsManAdapter } from '../adapter';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SmsManAdapter', () => {
  let adapter: SmsManAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios.create to return mocked axios instance
    mockedAxios.create = jest.fn().mockReturnValue({
      get: mockedAxios.get,
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);

    adapter = new SmsManAdapter({
      token: 'test-token',
      apiUrl: 'https://api.sms-man.com/control',
      pollIntervalMs: 1000,
      pollTimeoutMs: 5000,
    });
  });

  describe('getBalance', () => {
    it('should return balance successfully', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { balance: 10.50 },
      });

      const balance = await adapter.getBalance();
      
      expect(balance).toBe(10.50);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/get-balance',
        expect.objectContaining({
          params: { token: 'test-token' },
        })
      );
    });

    it('should throw error on invalid response', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {},
      });

      await expect(adapter.getBalance()).rejects.toThrow('Failed to retrieve SMS-MAN balance');
    });
  });

  describe('getCountries', () => {
    it('should return list of countries', async () => {
      const mockCountries = [
        { country_id: '1', country_name: 'Germany', country_code: 'de' },
        { country_id: '2', country_name: 'France', country_code: 'fr' },
      ];

      mockedAxios.get.mockResolvedValue({
        data: mockCountries,
      });

      const countries = await adapter.getCountries();
      
      expect(countries).toEqual(mockCountries);
      expect(countries.length).toBe(2);
    });

    it('should cache countries after first call', async () => {
      const mockCountries = [
        { country_id: '1', country_name: 'Germany', country_code: 'de' },
      ];

      mockedAxios.get.mockResolvedValue({
        data: mockCountries,
      });

      await adapter.getCountries();
      await adapter.getCountries();
      
      // Should only be called once due to caching
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCountryId', () => {
    it('should return country ID by name', async () => {
      const mockCountries = [
        { country_id: '1', country_name: 'Germany', country_code: 'de' },
        { country_id: '2', country_name: 'France', country_code: 'fr' },
      ];

      mockedAxios.get.mockResolvedValue({
        data: mockCountries,
      });

      const countryId = await adapter.getCountryId('Germany');
      
      expect(countryId).toBe('1');
    });

    it('should be case-insensitive', async () => {
      const mockCountries = [
        { country_id: '1', country_name: 'Germany', country_code: 'de' },
      ];

      mockedAxios.get.mockResolvedValue({
        data: mockCountries,
      });

      const countryId = await adapter.getCountryId('germany');
      
      expect(countryId).toBe('1');
    });

    it('should throw error if country not found', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [],
      });

      await expect(adapter.getCountryId('NonExistent')).rejects.toThrow('Country not found: NonExistent');
    });
  });

  describe('getWhatsAppApplicationId', () => {
    it('should find WhatsApp application', async () => {
      const mockApplications = [
        { application_id: '1', application_name: 'Telegram', application_code: 'tg' },
        { application_id: '2', application_name: 'WhatsApp', application_code: 'wa' },
      ];

      mockedAxios.get.mockResolvedValue({
        data: mockApplications,
      });

      const appId = await adapter.getWhatsAppApplicationId();
      
      expect(appId).toBe('2');
    });

    it('should throw error if WhatsApp not found', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          { application_id: '1', application_name: 'Telegram', application_code: 'tg' },
        ],
      });

      await expect(adapter.getWhatsAppApplicationId()).rejects.toThrow('WhatsApp application not found in SMS-MAN');
    });
  });

  describe('buyNumber', () => {
    it('should purchase number successfully', async () => {
      // Mock getPrices
      mockedAxios.get.mockResolvedValueOnce({
        data: [{ country_id: '1', application_id: '2', price: 0.5, count: 100 }],
      });

      // Mock buyNumber
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          request_id: 'req123',
          number: '+491234567890',
        },
      });

      const result = await adapter.buyNumber('1', '2');
      
      expect(result.request_id).toBe('req123');
      expect(result.number).toBe('+491234567890');
    });

    it('should throw error if no numbers available', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: [{ country_id: '1', application_id: '2', price: 0.5, count: 0 }],
      });

      await expect(adapter.buyNumber('1', '2')).rejects.toThrow('No numbers available for this country/application');
    });
  });

  describe('getSms', () => {
    it('should return SMS code when available', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          sms_code: '123456',
        },
      });

      const result = await adapter.getSms('req123');
      
      expect(result.sms_code).toBe('123456');
      expect(result.status).toBe('received');
    });

    it('should return wait status when SMS not ready', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          error_code: 'WAIT_SMS',
        },
      });

      const result = await adapter.getSms('req123');
      
      expect(result.status).toBe('wait');
    });
  });

  describe('setStatus', () => {
    it('should set status successfully', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {},
      });

      await expect(adapter.setStatus('req123', 'ready')).resolves.not.toThrow();
    });
  });

  describe('pollForSms', () => {
    it('should return SMS code after polling', async () => {
      // First call returns wait, second returns code
      mockedAxios.get
        .mockResolvedValueOnce({
          data: { error_code: 'WAIT_SMS' },
        })
        .mockResolvedValueOnce({
          data: { sms_code: '123456' },
        });

      const code = await adapter.pollForSms('req123');
      
      expect(code).toBe('123456');
    });

    it('should timeout after configured period', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { error_code: 'WAIT_SMS' },
      });

      await expect(adapter.pollForSms('req123')).rejects.toThrow('SMS polling timeout');
    }, 10000);
  });
});






