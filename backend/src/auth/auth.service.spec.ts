import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), create: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('register hashes the password and returns a signed token', async () => {
    usersService.findByEmail.mockResolvedValue(undefined);
    usersService.create.mockImplementation(async (data) => ({ id: 1, role: UserRole.USER, ...data }));

    const result = await service.register('Ada', 'ada@example.com', 'password123');

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ada', email: 'ada@example.com' }),
    );
    // The password handed to the repository must never be the plaintext one.
    const savedPassword = usersService.create.mock.calls[0][0].password;
    expect(savedPassword).not.toBe('password123');
    expect(await bcrypt.compare('password123', savedPassword)).toBe(true);
    expect(result).toEqual({
      access_token: 'signed-jwt',
      user: { id: 1, name: 'Ada', email: 'ada@example.com', role: UserRole.USER },
    });
  });

  it('register rejects a duplicate email', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 1, email: 'ada@example.com' });
    await expect(service.register('Ada', 'ada@example.com', 'password123')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('login rejects an unknown email', async () => {
    usersService.findByEmail.mockResolvedValue(undefined);
    await expect(service.login('nobody@example.com', 'whatever')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('login rejects an incorrect password', async () => {
    const hashed = await bcrypt.hash('correct-password', 10);
    usersService.findByEmail.mockResolvedValue({ id: 1, email: 'ada@example.com', password: hashed });

    await expect(service.login('ada@example.com', 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('login succeeds with the correct password', async () => {
    const hashed = await bcrypt.hash('correct-password', 10);
    usersService.findByEmail.mockResolvedValue({
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
      password: hashed,
      role: UserRole.USER,
    });

    const result = await service.login('ada@example.com', 'correct-password');
    expect(result.access_token).toBe('signed-jwt');
    expect(result.user.email).toBe('ada@example.com');
  });
});
