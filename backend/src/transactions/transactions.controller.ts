import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { FindTransactionsQueryDto } from './dto/find-transactions-query.dto';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

// Looser than the app-wide default (60/min) — unlike auth endpoints, these
// are authenticated and already scoped to req.user.id, so they carry none of
// the brute-force risk that default budget exists for. The per-row review
// workflow (Documents → Review) can legitimately fire one PATCH per
// transaction in quick succession; the default budget was getting exhausted
// partway through reviewing a single statement (bug: reviewing silently
// stalled after ~60 confirms, "fixed" only by navigating away and back long
// enough for the window to roll over).
const TRANSACTIONS_THROTTLE = { default: { limit: 600, ttl: 60_000 } };

@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
@Throttle(TRANSACTIONS_THROTTLE)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(req.user.id, dto);
  }

  @Post('recategorize')
  recategorizeAll(@Req() req: AuthenticatedRequest) {
    return this.transactionsService.recategorizeAll(req.user.id);
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindTransactionsQueryDto,
  ) {
    return this.transactionsService.findAllByUser(req.user.id, {
      ...query,
      search: query.search?.trim() || undefined,
    });
  }

  @Get(':id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.transactionsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.transactionsService.remove(id, req.user.id);
  }
}
