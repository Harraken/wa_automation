import { ProvisionService } from '../provision.service';
import { prisma } from '../../utils/db';
import { ProvisionState } from '@prisma/client';

jest.mock('../../utils/db', () => ({
  prisma: {
    provision: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../providers/smsman', () => ({
  SmsManAdapter: jest.fn().mockImplementation(() => ({
    getCountryId: jest.fn().mockResolvedValue('1'),
    getWhatsAppApplicationId: jest.fn().mockResolvedValue('2'),
    getBalance: jest.fn().mockResolvedValue(10.0),
    getCountries: jest.fn().mockResolvedValue([]),
    getApplications: jest.fn().mockResolvedValue([]),
  })),
}));

describe('ProvisionService', () => {
  let service: ProvisionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProvisionService();
  });

  describe('createProvision', () => {
    it('should create provision with auto-detected IDs', async () => {
      const mockProvision = {
        id: 'prov1',
        countryId: '1',
        applicationId: '2',
        state: ProvisionState.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.provision.create as jest.Mock).mockResolvedValue(mockProvision);

      const result = await service.createProvision({
        label: 'Test',
        linkToWeb: false,
      });

      expect(result.id).toBe('prov1');
      expect(result.countryId).toBe('1');
      expect(result.applicationId).toBe('2');
      expect(prisma.provision.create).toHaveBeenCalled();
    });

    it('should use provided country and application IDs', async () => {
      const mockProvision = {
        id: 'prov1',
        countryId: '99',
        applicationId: '88',
        state: ProvisionState.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.provision.create as jest.Mock).mockResolvedValue(mockProvision);

      const result = await service.createProvision({
        countryId: '99',
        applicationId: '88',
      });

      expect(result.countryId).toBe('99');
      expect(result.applicationId).toBe('88');
    });
  });

  describe('updateProvisionState', () => {
    it('should update provision state', async () => {
      const mockProvision = {
        id: 'prov1',
        state: ProvisionState.ACTIVE,
        updatedAt: new Date(),
      };

      (prisma.provision.update as jest.Mock).mockResolvedValue(mockProvision);

      const result = await service.updateProvisionState('prov1', ProvisionState.ACTIVE);

      expect(result.state).toBe(ProvisionState.ACTIVE);
      expect(prisma.provision.update).toHaveBeenCalledWith({
        where: { id: 'prov1' },
        data: {
          state: ProvisionState.ACTIVE,
          lastError: undefined,
        },
      });
    });

    it('should update provision state with error', async () => {
      const mockProvision = {
        id: 'prov1',
        state: ProvisionState.FAILED,
        lastError: 'Test error',
        updatedAt: new Date(),
      };

      (prisma.provision.update as jest.Mock).mockResolvedValue(mockProvision);

      const result = await service.updateProvisionState('prov1', ProvisionState.FAILED, 'Test error');

      expect(result.state).toBe(ProvisionState.FAILED);
      expect(result.lastError).toBe('Test error');
    });
  });

  describe('getProvision', () => {
    it('should return provision by ID', async () => {
      const mockProvision = {
        id: 'prov1',
        phone: '+491234567890',
        state: ProvisionState.ACTIVE,
      };

      (prisma.provision.findUnique as jest.Mock).mockResolvedValue(mockProvision);

      const result = await service.getProvision('prov1');

      expect(result?.id).toBe('prov1');
      expect(result?.phone).toBe('+491234567890');
    });

    it('should return null if provision not found', async () => {
      (prisma.provision.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getProvision('nonexistent');

      expect(result).toBeNull();
    });
  });
});






