export interface OnlineSimCountry {
  country: number;
  country_text: string;
  country_short: string;
  operators: string[];
}

export interface OnlineSimService {
  service: string;
  service_text: string;
  price: number;
  count: number;
}

export interface OnlineSimBalance {
  balance: number;
  currency: string;
}

export interface OnlineSimNumber {
  tzid: number;
  number: string;
  country: number;
  service: string;
  time: number;
  sum: number;
  status: string;
}

export interface OnlineSimSms {
  tzid: number;
  number: string;
  service: string;
  text: string;
  time: number;
  status: string;
}

export interface OnlineSimApiResponse<T> {
  response: T | string | number;
  error?: string;
}
