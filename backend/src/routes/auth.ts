import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, execute, verifyPassword } from '../config/db';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticates user and returns a session token
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const user = await queryOne('SELECT user_id, username, password_hash, role FROM users WHERE username = $1', [username.toLowerCase()]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const sessionId = uuidv4();
    // Expiry: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await execute(
      'INSERT INTO user_sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionId, user.user_id, expiresAt]
    );

    res.json({
      session_id: sessionId,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

/**
 * POST /api/auth/logout
 * Destroys active session
 */
router.post('/logout', async (req: Request, res: Response) => {
  const authHeader = req.header('Authorization');
  let sessionId = req.header('X-Session-ID');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'No active session token provided.' });
  }

  try {
    await execute('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
    res.json({ status: 'Success', message: 'Logged out successfully.' });
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error during logout.' });
  }
});

/**
 * GET /api/auth/me
 * Validates session token and returns active user credentials
 */
router.get('/me', async (req: Request, res: Response) => {
  const authHeader = req.header('Authorization');
  let sessionId = req.header('X-Session-ID');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }

  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized. Missing session token.' });
  }

  try {
    const session = await queryOne('SELECT user_id, expires_at FROM user_sessions WHERE session_id = $1', [sessionId]);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized. Session not found.' });
    }

    if (new Date(session.expires_at) < new Date()) {
      await execute('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
      return res.status(401).json({ error: 'Unauthorized. Session expired.' });
    }

    const user = await queryOne('SELECT user_id, username, role FROM users WHERE user_id = $1', [session.user_id]);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. User not found.' });
    }

    res.json({
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('Auth check error:', err);
    res.status(500).json({ error: 'Internal server error validating session.' });
  }
});

export default router;
