import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FinanceChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}
