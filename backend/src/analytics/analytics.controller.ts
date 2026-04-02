import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';
import { FinanceChatDto } from './dto/finance-chat.dto';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary(
    @Req() req: any,
    @Query('accountId') accountId?: string,
    @Query('dateRange') dateRange?: string,
  ) {
    const accountIdNum = accountId ? parseInt(accountId, 10) : undefined;
    return this.analyticsService.getSummary(
      req.user.id,
      accountIdNum != null && !isNaN(accountIdNum) ? accountIdNum : undefined,
      dateRange,
    );
  }

  @Get('ai-insights')
  getAiInsights(
    @Req() req: any,
    @Query('accountId') accountId?: string,
    @Query('dateRange') dateRange?: string,
  ) {
    const accountIdNum = accountId ? parseInt(accountId, 10) : undefined;
    return this.analyticsService.getAiInsights(
      req.user.id,
      accountIdNum != null && !isNaN(accountIdNum) ? accountIdNum : undefined,
      dateRange,
    );
  }

  @Post('chat')
  financeChat(@Req() req: any, @Body() dto: FinanceChatDto) {
    return this.analyticsService.financeChat(req.user.id, dto.message);
  }
}
