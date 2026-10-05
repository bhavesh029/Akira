import { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentRawText1791137900000 implements MigrationInterface {
  name = 'DocumentRawText1791137900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD "raw_text" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "raw_text"`);
  }
}
