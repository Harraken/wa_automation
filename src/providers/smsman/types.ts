export interface SmsManConfig {
  token: string;
  apiUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface SmsManCountry {
  country_id: string;
  country_name: string;
  country_code: string;
}

export interface SmsManApplication {
  application_id: string;
  application_name: string;
  application_code: string;
}

export interface SmsManPrice {
  country_id: string;
  application_id: string;
  price: number;
  count: number;
}

export interface BuyNumberResponse {
  request_id: string;
  number: string;
}

export interface GetSmsResponse {
  sms_code?: string;
  status?: 'wait' | 'received' | 'cancelled' | 'rejected';
  error_code?: string;
  error_msg?: string;
}

export interface BalanceResponse {
  balance: number;
}

export interface ApiResponse<T> {
  status?: 'success' | 'error';
  data?: T;
  error_code?: string;
  error_msg?: string;
}



