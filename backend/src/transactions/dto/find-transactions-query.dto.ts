import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType } from '../../entities/transaction.entity';

/**
 * Query params for GET /transactions. Bug #8: `type` was previously typed
 * as `TransactionType` on a raw `@Query('type')` string with no actual
 * validation — an invalid value reached the Postgres enum column directly
 * and raised an unhandled 500 instead of a clean 400. Using a validated DTO
 * here (the global ValidationPipe in main.ts applies to `@Query()` objects
 * the same way it does `@Body()`) fixes that for every field, not just type.
 */
export class FindTransactionsQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  accountId?: number;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
