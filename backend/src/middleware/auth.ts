import { Request, Response, NextFunction } from 'express';
import { queryOne, execute } from '../config/db';

export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    role: string;
  };
}

/**
 * Middleware: Verifies session token from Authorization or X-Session-ID header
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header('Authorization');
  let sessionId = req.header('X-Session-ID');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }

  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required. No session token provided.' });
  }

  (async () => {
    try {
      const session = await queryOne('SELECT user_id, expires_at FROM user_sessions WHERE session_id = $1', [sessionId]);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized. Invalid session.' });
      }

      if (new Date(session.expires_at) < new Date()) {
        await execute('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
        return res.status(401).json({ error: 'Unauthorized. Session expired.' });
      }

      const user = await queryOne('SELECT user_id, username, role FROM users WHERE user_id = $1', [session.user_id]);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized. User not found.' });
      }

      // Attach user credentials to request
      (req as AuthenticatedRequest).user = {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      };
      
      next();
    } catch (err) {
      console.error('Authentication error:', err);
      res.status(500).json({ error: 'Authentication processing error.' });
    }
  })();
}

/**
 * Middleware: Enforces that the authenticated user possesses one of the allowed roles
 */
export const requireRoles = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    authenticateToken(req, res, () => {
      const authReq = req as AuthenticatedRequest;
      if (authReq.user && allowedRoles.includes(authReq.user.role)) {
        next();
      } else {
        const role = authReq.user?.role || 'Guest';
        res.status(403).json({
          error: `Permission Denied. Role '${role}' does not have access to this resource.`,
        });
      }
    });
  };
};
