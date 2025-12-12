import { ProvisionState } from '@prisma/client';
import { createChildLogger } from '../utils/logger';
import { config } from '../config';
import { OnlineSimAdapter } from '../providers/onlinesim';
import { prisma } from '../utils/db';

const logger = createChildLogger('onlinesim-provision-service');

export interface CreateProvisionInput {
  countryId?: number;
  serviceId?: string;
  label?: string;
  linkToWeb?: boolean;
  metadata?: Record<string, any>;
}

export class OnlineSimProvisionService {
  private onlinesimAdapter: OnlineSimAdapter;

  constructor() {
    this.onlinesimAdapter = new OnlineSimAdapter({
      apiKey: config.onlinesim.apiKey,
      baseUrl: config.onlinesim.baseUrl,
      pollIntervalMs: config.onlinesim.pollIntervalMs,
      pollTimeoutMs: config.onlinesim.pollTimeoutMs,
    });
  }

  /**
   * Create a new provision
   */
  async createProvision(input: CreateProvisionInput) {
    logger.info({ input }, 'Creating provision');

    // Auto-detect country_id if not provided
    let countryId = input.countryId;
    if (!countryId) {
      logger.info({ defaultCountry: config.onlinesim.defaultCountry }, 'Attempting to get country ID for default country');
      try {
        countryId = await this.onlinesimAdapter.getCountryId(config.onlinesim.defaultCountry);
        logger.info({ country: config.onlinesim.defaultCountry, countryId }, 'Auto-detected country ID');
      } catch (error: any) {
        logger.error({ error: error.message, stack: error.stack, defaultCountry: config.onlinesim.defaultCountry }, 'Failed to get country ID');
        throw error;
      }
    }

    // Auto-detect service_id for WhatsApp if not provided
    let serviceId = input.serviceId;
    if (!serviceId) {
      logger.info({ countryId }, 'Attempting to get WhatsApp service ID');
      try {
        serviceId = await this.onlinesimAdapter.getWhatsAppServiceId(countryId);
        logger.info({ countryId, serviceId }, 'Auto-detected WhatsApp service ID');
      } catch (error: any) {
        logger.error({ error: error.message, countryId }, 'Failed to get WhatsApp service ID');
        throw error;
      }
    }

    const provision = await prisma.provision.create({
      data: {
        countryId: countryId.toString(),
        applicationId: serviceId,
        label: input.label,
        linkToWeb: input.linkToWeb || false,
        metadata: input.metadata,
        state: ProvisionState.PENDING,
      },
    });

    logger.info({ provisionId: provision.id }, 'Provision created');
    return provision;
  }

  /**
   * Get provision by ID
   */
  async getProvision(id: string) {
    return prisma.provision.findUnique({
      where: { id },
      include: {
        sessions: true,
        otpLogs: true,
      },
    });
  }

  /**
   * List provisions
   */
  async listProvisions(limit: number = 50, offset: number = 0) {
    return prisma.provision.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        sessions: true,
        otpLogs: true,
      },
    });
  }

  /**
   * Update provision state
   */
  async updateProvisionState(id: string, state: ProvisionState, error?: string) {
    return prisma.provision.update({
      where: { id },
      data: {
        state,
        lastError: error,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Update provision with phone number
   */
  async updateProvisionNumber(id: string, _requestId: string, phone: string) {
    return prisma.provision.update({
      where: { id },
      data: {
        phone,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get account balance
   */
  async getBalance() {
    return this.onlinesimAdapter.getBalance();
  }

  /**
   * Get available countries
   */
  async getCountries() {
    return this.onlinesimAdapter.getCountries();
  }

  /**
   * Get services for a country
   */
  async getServices(country: number) {
    return this.onlinesimAdapter.getServices(country);
  }

  /**
   * Buy a number
   */
  async buyNumber(countryId: number, serviceId: string) {
    return this.onlinesimAdapter.buyNumber(countryId, serviceId);
  }

  /**
   * Poll for SMS
   */
  async pollForSms(requestId: string) {
    return this.onlinesimAdapter.pollForSms(parseInt(requestId));
  }

  /**
   * Set SMS status
   */
  async setStatus(requestId: string, status: string) {
    return this.onlinesimAdapter.setStatus(parseInt(requestId), status);
  }
}

export const onlinesimProvisionService = new OnlineSimProvisionService();
