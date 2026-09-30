import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  User,
  Account,
  Document,
  Transaction,
  DocumentChunk,
} from './entities';

/**
 * TypeORM CLI data source (migration:generate/run/revert).
 * Separate from app.module.ts's TypeOrmModule.forRootAsync because the CLI
 * runs outside Nest's DI/ConfigModule — synchronize is always off here since
 * migrations are the only supported way to change schema through this source.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Account, Document, Transaction, DocumentChunk],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
