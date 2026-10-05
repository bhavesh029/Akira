import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconciliationAndReview1791136200000 implements MigrationInterface {
  name = 'ReconciliationAndReview1791136200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "reviewed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "documents" ADD "error_message" text`);
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "opening_balance" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "closing_balance" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "reconciled_delta" numeric(12,2)`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."documents_reconciliation_status_enum" AS ENUM('NOT_APPLICABLE', 'MATCHED', 'MISMATCH')`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "reconciliation_status" "public"."documents_reconciliation_status_enum" NOT NULL DEFAULT 'NOT_APPLICABLE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "reconciliation_status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."documents_reconciliation_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "reconciled_delta"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "closing_balance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "opening_balance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "error_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "reviewed"`,
    );
  }
}
