import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  @IsDateString()
  @IsNotEmpty()
  transaction_date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsInt()
  @Type(() => Number)
  accountId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  documentId?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
