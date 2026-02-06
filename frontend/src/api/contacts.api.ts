import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api';

export interface CreateContactRequest {
  sessionId: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
}

export interface CreateContactResponse {
  success: boolean;
  message: string;
  contact: {
    firstName?: string;
    lastName?: string;
    phoneNumber: string;
  };
}

/**
 * Create a WhatsApp contact via UI automation
 */
export const createWhatsAppContact = async (
  data: CreateContactRequest
): Promise<CreateContactResponse> => {
  const response = await axios.post<CreateContactResponse>(
    `${API_URL}/contacts/create`,
    data
  );
  return response.data;
};

