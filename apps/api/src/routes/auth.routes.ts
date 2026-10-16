import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { registerSchema, loginSchema, ApiResponse, AuthResponse, User } from '@matinee/shared';
import { env } from '../config/env';
import { getStore } from '../db/store';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

function generateToken(user: User): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/v1/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const store = getStore();

    const existing = await store.findUserByEmail(input.email);
    if (existing) {
      throw new AppError(409, 'USER_EXISTS', 'An account with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    const newUser = await store.createUser({
      id: `u-${Date.now()}`,
      email: input.email,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      passwordHash,
      role: 'customer',
    });

    const { passwordHash: _, ...safeUser } = newUser;
    const token = generateToken(safeUser);

    const response: ApiResponse<AuthResponse> = {
      success: true,
      data: { token, user: safeUser },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };

    return res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const store = getStore();

    const user = await store.findUserByEmail(input.email);
    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const isValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const { passwordHash: _, ...safeUser } = user;
    const token = generateToken(safeUser);

    const response: ApiResponse<AuthResponse> = {
      success: true,
      data: { token, user: safeUser },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/demo-login (instant demo user login)
router.post('/demo-login', async (req, res, next) => {
  try {
    const store = getStore();
    const demoUser = await store.findUserById('u-1001-demo-user-id');
    if (!demoUser) {
      throw new AppError(500, 'DEMO_USER_MISSING', 'Demo account configuration error');
    }

    const { passwordHash: _, ...safeUser } = demoUser;
    const token = generateToken(safeUser);

    const response: ApiResponse<AuthResponse> = {
      success: true,
      data: { token, user: safeUser },
      meta: { requestId: req.id, timestamp: new Date().toISOString(), isDemoData: true },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const user = await store.findUserById(req.user!.id);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User profile not found');
    }
    const { passwordHash: _, ...safeUser } = user;

    const response: ApiResponse<{ user: User }> = {
      success: true,
      data: { user: safeUser },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
