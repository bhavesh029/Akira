import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('register delegates to AuthService.register with the DTO fields', async () => {
    authService.register.mockResolvedValue({ access_token: 't' });
    await controller.register({ name: 'Ada', email: 'ada@example.com', password: 'password123' } as any);
    expect(authService.register).toHaveBeenCalledWith('Ada', 'ada@example.com', 'password123');
  });

  it('login delegates to AuthService.login with the DTO fields', async () => {
    authService.login.mockResolvedValue({ access_token: 't' });
    await controller.login({ email: 'ada@example.com', password: 'password123' } as any);
    expect(authService.login).toHaveBeenCalledWith('ada@example.com', 'password123');
  });
});
