import { Provision, ProvisionState } from '@prisma/client';
import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';
import { SmsManAdapter } from '../providers/smsman';
import { config } from '../config';

const logger = createChildLogger('provision-service');

export interface CreateProvisionInput {
  countryId?: string;
  applicationId?: string;
  label?: string;
  linkToWeb?: boolean;
  metadata?: Record<string, any>;
}

export class ProvisionService {
  private smsManAdapter: SmsManAdapter;

  constructor() {
    this.smsManAdapter = new SmsManAdapter({
      token: config.smsMan.token,
      apiUrl: config.smsMan.apiUrl,
      pollIntervalMs: config.smsMan.pollIntervalMs,
      pollTimeoutMs: config.smsMan.pollTimeoutMs,
    });
  }

  /**
   * Create a new provision
   */
  async createProvision(input: CreateProvisionInput): Promise<Provision> {
    logger.info({ input }, 'Creating provision');

    try {
      // Store countryId as-is (can be country name or numeric ID)
      // If empty, worker will auto-detect available country
      let countryId = input.countryId || '';
      
      if (!countryId) {
        // Empty countryId = auto-detect in worker
        logger.info('No country specified, worker will auto-detect available country');
      }

      // Note: application_id is not needed for OnlineSim, but we keep it for compatibility
      let applicationId = input.applicationId || '';

      const provision = await prisma.provision.create({
        data: {
          countryId, // Can be country name or ID - worker will resolve it
          applicationId,
          label: input.label,
          linkToWeb: input.linkToWeb ?? config.features.linkToWebDefault,
          metadata: input.metadata || {},
          state: ProvisionState.PENDING,
        },
      });

      logger.info({ provisionId: provision.id, countryId }, 'Provision created');
      return provision;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create provision');
      throw error;
    }
  }

  /**
   * Update provision state
   */
  async updateProvisionState(
    provisionId: string,
    state: ProvisionState,
    error?: string
  ): Promise<Provision> {
    logger.info({ provisionId, state, error }, 'Updating provision state');

    return await prisma.provision.update({
      where: { id: provisionId },
      data: {
        state,
        lastError: error,
      },
    });
  }

  /**
   * Update provision with phone number and request ID
   */
  async updateProvisionNumber(
    provisionId: string,
    requestIdSmsman: string,
    phone: string
  ): Promise<Provision> {
    logger.info({ provisionId, requestIdSmsman, phone }, 'Updating provision number');

    // Check if requestIdSmsman already exists in another provision
    const existingProvision = await prisma.provision.findFirst({
      where: { 
        requestIdSmsman,
        id: { not: provisionId }
      },
    });

    if (existingProvision) {
      logger.warn({ provisionId, requestIdSmsman, existingProvisionId: existingProvision.id }, 'Request ID already exists, skipping requestIdSmsman update');
      // Only update phone, skip requestIdSmsman to avoid unique constraint violation
      return await prisma.provision.update({
        where: { id: provisionId },
        data: {
          phone,
        },
      });
    }

    return await prisma.provision.update({
      where: { id: provisionId },
      data: {
        requestIdSmsman, // Already a string from SMS-MAN API
        phone,
      },
    });
  }

  /**
   * Get provision by ID
   */
  async getProvision(provisionId: string): Promise<any> {
    return await prisma.provision.findUnique({
      where: { id: provisionId },
      include: {
        sessions: true,
        otpLogs: true,
      },
    });
  }

  /**
   * List all provisions
   */
  async listProvisions(limit = 50, offset = 0): Promise<Provision[]> {
    return await prisma.provision.findMany({
      take: limit,
      skip: offset,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sessions: {
          where: {
            isActive: true,
          },
        },
      },
    });
  }

  /**
   * Get SMS-MAN balance
   */
  async getBalance(): Promise<number> {
    return await this.smsManAdapter.getBalance();
  }

  /**
   * Get SMS-MAN countries
   */
  async getCountries() {
    return await this.smsManAdapter.getCountries();
  }

  /**
   * Get SMS-MAN applications
   */
  async getApplications() {
    return await this.smsManAdapter.getApplications();
  }
}

export const provisionService = new ProvisionService();

