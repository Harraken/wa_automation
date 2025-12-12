import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';
import { OnlineSimAdapter } from '../providers/onlinesim';
import { config } from '../config';

const logger = createChildLogger('phone-number-service');

export class PhoneNumberService {
  /**
   * Clean up expired TZIDs by checking them with OnlineSim API
   * Deletes all numbers with expired/invalid TZIDs
   */
  async cleanupExpiredTzids(): Promise<number> {
    try {
      logger.info('Starting cleanup of expired TZIDs...');
      
      // Get all OnlineSim phone numbers with TZIDs
      const onlineSimNumbers = await prisma.phoneNumber.findMany({
        where: {
          provider: 'ONLINESIM',
          requestId: { not: null },
        },
      });

      if (onlineSimNumbers.length === 0) {
        logger.info('No OnlineSim numbers found to check');
        return 0;
      }

      logger.info({ count: onlineSimNumbers.length }, 'Checking TZIDs for expiration...');

      const onlineSimAdapter = new OnlineSimAdapter({
        apiKey: config.onlinesim.apiKey,
        baseUrl: config.onlinesim.baseUrl,
        pollIntervalMs: config.onlinesim.pollIntervalMs,
        pollTimeoutMs: config.onlinesim.pollTimeoutMs,
      });

      // Check all TZIDs in parallel (but limit concurrency to avoid API rate limits)
      const batchSize = 10;
      let deletedCount = 0;

      for (let i = 0; i < onlineSimNumbers.length; i += batchSize) {
        const batch = onlineSimNumbers.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(async (phoneNumber) => {
            if (!phoneNumber.requestId) return;
            
            try {
              // Try to get SMS status - if it throws ERROR_NO_OPERATIONS, TZID is expired
              await onlineSimAdapter.getSms(Number(phoneNumber.requestId));
              // If no error, TZID is still valid
              return { phoneNumber, expired: false };
            } catch (error: any) {
              if (error.code === 'ERROR_NO_OPERATIONS' || 
                  error.message === 'TZID_NO_LONGER_VALID' ||
                  (error.message && error.message.includes('ERROR_NO_OPERATIONS'))) {
                // TZID is expired
                return { phoneNumber, expired: true };
              }
              // Other errors (network, etc.) - assume still valid to be safe
              return { phoneNumber, expired: false };
            }
          })
        );

        // Delete expired numbers
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value && result.value.expired) {
            try {
              await prisma.phoneNumber.delete({
                where: { id: result.value.phoneNumber.id },
              });
              deletedCount++;
              logger.debug({ phone: result.value.phoneNumber.phone, tzid: result.value.phoneNumber.requestId }, 'Deleted expired TZID');
            } catch (deleteError: any) {
              logger.warn({ error: deleteError.message, phone: result.value.phoneNumber.phone }, 'Failed to delete expired number');
            }
          }
        }
      }

      logger.info({ deletedCount, total: onlineSimNumbers.length }, 'TZID cleanup completed');
      return deletedCount;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to cleanup expired TZIDs');
      return 0;
    }
  }

  /**
   * Save a newly purchased number
   */
  async savePhoneNumber(data: {
    phone: string;
    requestId: string;
    provider: 'SMS-MAN' | 'ONLINESIM';
    countryId?: string;
  }): Promise<string> {
    try {
      const phoneNumber = await prisma.phoneNumber.upsert({
        where: { phone: data.phone },
        update: {
          requestId: data.requestId,
          countryId: data.countryId,
        },
        create: {
          phone: data.phone,
          requestId: data.requestId,
          provider: data.provider,
          countryId: data.countryId,
          isUsed: false,
        },
      });

      logger.info({ phone: data.phone, id: phoneNumber.id }, 'Phone number saved');
      return phoneNumber.id;
    } catch (error: any) {
      logger.error({ error: error.message, phone: data.phone }, 'Failed to save phone number');
      throw error;
    }
  }

  /**
   * Mark a phone number as used
   */
  async markAsUsed(phoneNumberId: string, provisionId: string): Promise<void> {
    try {
      await prisma.phoneNumber.update({
        where: { id: phoneNumberId },
        data: {
          isUsed: true,
          usedAt: new Date(),
          provisionId,
        },
      });

      logger.info({ phoneNumberId, provisionId }, 'Phone number marked as used');
    } catch (error: any) {
      logger.error({ error: error.message, phoneNumberId, provisionId }, 'Failed to mark phone number as used');
    }
  }

  /**
   * Mark a phone number as used by phone number
   */
  async markAsUsedByPhone(phone: string, provisionId: string): Promise<void> {
    try {
      await prisma.phoneNumber.updateMany({
        where: { phone },
        data: {
          isUsed: true,
          usedAt: new Date(),
          provisionId,
        },
      });

      logger.info({ phone, provisionId }, 'Phone number marked as used by phone');
    } catch (error: any) {
      logger.error({ error: error.message, phone, provisionId }, 'Failed to mark phone number as used');
    }
  }

  /**
   * Delete a phone number by phone number or request ID (when TZID is invalid)
   */
  async deletePhoneNumber(phone?: string, requestId?: string): Promise<void> {
    try {
      if (phone) {
        const deleted = await prisma.phoneNumber.deleteMany({
          where: { phone },
        });
        logger.info({ phone, deletedCount: deleted.count }, 'Phone number deleted by phone');
      } else if (requestId) {
        const deleted = await prisma.phoneNumber.deleteMany({
          where: { requestId },
        });
        logger.info({ requestId, deletedCount: deleted.count }, 'Phone number deleted by request ID');
      } else {
        throw new Error('Either phone or requestId must be provided');
      }
    } catch (error: any) {
      logger.error({ error: error.message, phone, requestId }, 'Failed to delete phone number');
      throw error;
    }
  }
}

export const phoneNumberService = new PhoneNumberService();
