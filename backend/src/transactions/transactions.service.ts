import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionType } from '../entities/transaction.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { AccountsService } from '../accounts/accounts.service';

export interface TransactionFilters {
  accountId?: number;
  type?: TransactionType;
  category?: string;
  from?: string; // date string
  to?: string;   // date string
  /** Case-insensitive match on description or category (PostgreSQL ILIKE) */
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedTransactionsResult {
  data: Transaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    private readonly accountsService: AccountsService,
  ) {}

  async create(userId: number, dto: CreateTransactionDto): Promise<Transaction> {
    // Validate account ownership
    await this.accountsService.findOne(dto.accountId, userId);

    const transaction = this.transactionsRepository.create({
      ...dto,
      userId,
    });
    return this.transactionsRepository.save(transaction);
  }

  async findAllByUser(userId: number, filters?: TransactionFilters): Promise<PaginatedTransactionsResult> {
    const page = Math.max(1, filters?.page ?? DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, filters?.limit ?? DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    const qb = this.transactionsRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.account', 'account')
      .where('tx.userId = :userId', { userId });

    if (filters?.accountId) {
      qb.andWhere('tx.accountId = :accountId', { accountId: filters.accountId });
    }
    if (filters?.type) {
      qb.andWhere('tx.type = :type', { type: filters.type });
    }
    if (filters?.category) {
      qb.andWhere('tx.category = :category', { category: filters.category });
    }
    if (filters?.from && filters?.to) {
      qb.andWhere('tx.transaction_date BETWEEN :from AND :to', {
        from: filters.from,
        to: filters.to,
      });
    }
    const search = filters?.search?.trim();
    if (search) {
      qb.andWhere('(tx.description ILIKE :search OR tx.category ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    qb.orderBy('tx.transaction_date', 'DESC').addOrderBy('tx.created_at', 'DESC');

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { data, total, page, limit, totalPages };
  }

  async findOne(id: number, userId: number): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id, userId },
      relations: ['account'],
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
    return transaction;
  }

  async update(id: number, userId: number, dto: UpdateTransactionDto): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id, userId },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
    // Validate account ownership if accountId is being updated
    if (dto.accountId != null) {
      await this.accountsService.findOne(dto.accountId, userId);
    }
    Object.assign(transaction, dto);
    return this.transactionsRepository.save(transaction);
  }

  async remove(id: number, userId: number): Promise<void> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id, userId },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
    await this.transactionsRepository.remove(transaction);
  }

  async countByUser(userId: number): Promise<number> {
    return this.transactionsRepository.count({ where: { userId } });
  }
}
