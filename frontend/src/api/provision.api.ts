import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002';

export interface CreateProvisionInput {
  country_id?: string;
  application_id?: string;
  linkToWeb?: boolean;
}

export async function createProvision(input: CreateProvisionInput): Promise<{ provision_id: string }> {
  const response = await axios.post(`${API_URL}/provision`, input);
  return response.data;
}

export async function getProvisionStatus(provisionId: string): Promise<any> {
  const response = await axios.get(`${API_URL}/provision/${provisionId}`);
  return response.data;
}



