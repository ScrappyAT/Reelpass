import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: {
        id: string;
        email: string;
        role: string;
        fullName: string;
      };
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const provided = req.get('x-request-id');
  const reqId = provided && /^[A-Za-z0-9_-]{1,64}$/.test(provided) ? provided : crypto.randomUUID();
  req.id = reqId;
  res.setHeader('x-request-id', reqId);
  next();
}
