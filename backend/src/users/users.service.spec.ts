import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    usersRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: usersRepository }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findByEmail returns undefined (not null) when no user matches', async () => {
    usersRepository.findOne.mockResolvedValue(null);
    await expect(service.findByEmail('nobody@example.com')).resolves.toBeUndefined();
  });

  it('findByEmail returns the user when found', async () => {
    const user = { id: 1, email: 'a@b.com' };
    usersRepository.findOne.mockResolvedValue(user);
    await expect(service.findByEmail('a@b.com')).resolves.toBe(user);
  });
});
