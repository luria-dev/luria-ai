import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const mockHealth = {
    status: 'up',
    timestamp: '2026-03-02T00:00:00.000Z',
    services: {
      process: { status: 'up' },
      postgres: { status: 'up' },
      redis: { status: 'up' },
    },
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealth: jest.fn().mockResolvedValue(mockHealth),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status payload', async () => {
      await expect(appController.getHealth()).resolves.toEqual(mockHealth);
    });
  });
});
