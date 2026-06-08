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

/**
 * GET /api/auth/diagnostics
 * Safe public diagnostic check
 */
router.get('/diagnostics', async (req: Request, res: Response) => {
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DB_HOST: process.env.DB_HOST ? `SET (length: ${process.env.DB_HOST.length})` : 'NOT_SET',
      DB_DATABASE: process.env.DB_DATABASE ? 'SET' : 'NOT_SET',
      DB_USER: process.env.DB_USER ? 'SET' : 'NOT_SET',
      GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME || 'NOT_SET',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? `SET (starts with ${process.env.GEMINI_API_KEY.substring(0, 5)}... length: ${process.env.GEMINI_API_KEY.length})` : 'NOT_SET',
    },
    database: {
      type: 'unknown',
      connected: false,
      error: null as string | null
    },
    gcs: {
      enabled: false,
      bucket: process.env.GCS_BUCKET_NAME || '',
      connected: false,
      error: null as string | null
    },
    gemini: {
      configured: false,
      test_call_success: false,
      error: null as string | null
    }
  };

  // 1. Test database connection
  try {
    const { getIsPostgres, queryOne } = require('../config/db');
    diagnostics.database.type = getIsPostgres() ? 'PostgreSQL' : 'SQLite';
    const dbTest = await queryOne('SELECT 1 + 1 as result');
    if (dbTest && (dbTest.result === 2 || dbTest.result === '2')) {
      diagnostics.database.connected = true;
    } else {
      diagnostics.database.error = 'Returned incorrect value: ' + JSON.stringify(dbTest);
    }
  } catch (err: any) {
    diagnostics.database.error = err.message || String(err);
  }

  // 2. Test GCS Connection
  try {
    const { isGcsEnabled } = require('../services/storage');
    diagnostics.gcs.enabled = isGcsEnabled();
    if (isGcsEnabled()) {
      const { Storage } = require('@google-cloud/storage');
      const storage = new Storage();
      const bucketName = process.env.GCS_BUCKET_NAME || '';
      const [exists] = await storage.bucket(bucketName).exists();
      diagnostics.gcs.connected = exists;
      if (!exists) {
        diagnostics.gcs.error = `Bucket ${bucketName} does not exist.`;
      }
    }
  } catch (err: any) {
    diagnostics.gcs.error = err.message || String(err);
  }

  // 3. Test Gemini Connection
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    diagnostics.gemini.configured = true;
    diagnostics.gemini.tested_models = {};
    try {
      const https = require('https');
      const modelsToTest = ['gemini-3.5-flash', 'gemini-2.5-flash'];
      
      for (const model of modelsToTest) {
        const testPromise = new Promise<{ success: boolean; error?: string; status_code?: number }>((resolve) => {
          const testPromptBody = JSON.stringify({
            contents: [{ parts: [{ text: "Respond with exactly the word: HELLO" }] }]
          });
          const apiReq = https.request(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              timeout: 5000
            },
            (apiRes: any) => {
              let body = '';
              apiRes.on('data', (chunk: any) => (body += chunk));
              apiRes.on('end', () => {
                try {
                  const parsed = JSON.parse(body);
                  if (apiRes.statusCode === 200) {
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text && text.trim().toUpperCase().includes('HELLO')) {
                      resolve({ success: true });
                    } else {
                      resolve({ success: false, error: `Unexpected body structure: ${body.substring(0, 200)}`, status_code: apiRes.statusCode });
                    }
                  } else {
                    const errMsg = parsed.error?.message || JSON.stringify(parsed);
                    resolve({ success: false, error: errMsg, status_code: apiRes.statusCode });
                  }
                } catch (e: any) {
                  resolve({ success: false, error: `Parse error: ${e.message}. Body: ${body.substring(0, 200)}`, status_code: apiRes.statusCode });
                }
              });
            }
          );
          apiReq.on('error', (err: any) => resolve({ success: false, error: err.message, status_code: 0 }));
          apiReq.on('timeout', () => {
            apiReq.destroy();
            resolve({ success: false, error: 'Request timed out after 5000ms', status_code: 0 });
          });
          apiReq.write(testPromptBody);
          apiReq.end();
        });
        
        const result = await testPromise;
        diagnostics.gemini.tested_models[model] = result;
        if (result.success) {
          diagnostics.gemini.test_call_success = true;
        }
      }
      
      if (!diagnostics.gemini.test_call_success) {
        diagnostics.gemini.error = 'All tested models failed. Check billing, quota, or network access.';
      }
    } catch (err: any) {
      diagnostics.gemini.error = err.message || String(err);
    }
  }

  // 4. Fetch last 10 audit logs
  try {
    const { query } = require('../config/db');
    const logs = await query('SELECT * FROM document_audit_logs ORDER BY changed_at DESC LIMIT 10');
    diagnostics.recent_audit_logs = logs;
  } catch (err: any) {
    diagnostics.recent_audit_logs_error = err.message || String(err);
  }

  res.json(diagnostics);
});

export default router;
