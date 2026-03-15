import { IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { AccountType } from '../../entities/account.entity';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  bank_name: string;

  @IsEnum(AccountType)
  account_type: AccountType;

  @IsOptional()
  @IsString()
  @Length(4, 4, { message: 'account_number_last_four must be exactly 4 characters' })
  account_number_last_four?: string;
}
