import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { TransactionType } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  @IsDateString()
  @IsNotEmpty()
  transaction_date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
