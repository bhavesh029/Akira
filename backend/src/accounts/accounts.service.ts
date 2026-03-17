import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}

  async create(userId: number, dto: CreateAccountDto): Promise<Account> {
    const account = this.accountsRepository.create({
      ...dto,
      userId,
    });
    return this.accountsRepository.save(account);
  }

  async findAllByUser(userId: number): Promise<Account[]> {
    return this.accountsRepository.find({
      where: { userId },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: number, userId: number): Promise<Account> {
    const account = await this.accountsRepository.findOne({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
    return account;
  }

  async update(id: number, userId: number, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(id, userId);
    Object.assign(account, dto);
    return this.accountsRepository.save(account);
  }

  async remove(id: number, userId: number): Promise<void> {
    const account = await this.findOne(id, userId);
    await this.accountsRepository.remove(account);
  }
}
