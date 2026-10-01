import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: { getSummary: jest.Mock; getAiInsights: jest.Mock; financeChat: jest.Mock };

  beforeEach(async () => {
    analyticsService = {
      getSummary: jest.fn(),
      getAiInsights: jest.fn(),
      financeChat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getSummary parses accountId/dateRange and scopes to the authenticated user', () => {
    analyticsService.getSummary.mockReturnValue({ metrics: {} });
    controller.getSummary({ user: { id: 7 } } as any, '3', '1m');
    expect(analyticsService.getSummary).toHaveBeenCalledWith(7, 3, '1m');
  });

  it('getSummary passes undefined accountId when it is not a valid number', () => {
    analyticsService.getSummary.mockReturnValue({ metrics: {} });
    controller.getSummary({ user: { id: 7 } } as any, undefined, 'all');
    expect(analyticsService.getSummary).toHaveBeenCalledWith(7, undefined, 'all');
  });

  it('financeChat delegates to AnalyticsService.financeChat with the user id and message', () => {
    analyticsService.financeChat.mockResolvedValue({ answer: 'hi' });
    controller.financeChat({ user: { id: 7 } } as any, { message: 'how much did I spend?' } as any);
    expect(analyticsService.financeChat).toHaveBeenCalledWith(7, 'how much did I spend?');
  });
});
