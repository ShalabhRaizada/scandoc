import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, hashPassword } from '../config/db';
import { requireRoles, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Secure all endpoints under this router to Admin role only
router.use(requireRoles(['Admin']));

/**
 * GET /api/users
 * Returns list of all registered users (excluding password hashes)
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await query('SELECT user_id, username, role, last_login, created_at FROM users ORDER BY username ASC');
    res.json(users);
  } catch (err: any) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to retrieve users list.' });
  }
});

/**
 * POST /api/users
 * Creates a new user profile
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const allowedRoles = ['Admin', 'Ops User', 'Viewer', 'Auditor', 'API User'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Allowed roles are: ${allowedRoles.join(', ')}` });
  }

  try {
    const existing = await queryOne('SELECT user_id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const userId = uuidv4();
    const hash = hashPassword(password);

    await execute(
      'INSERT INTO users (user_id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
      [userId, username.toLowerCase(), hash, role]
    );

    res.status(201).json({
      message: 'User created successfully.',
      user: {
        user_id: userId,
        username: username.toLowerCase(),
        role
      }
    });
  } catch (err: any) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

/**
 * PUT /api/users/:user_id
 * Updates password and/or role of a user
 */
router.put('/:user_id', async (req: AuthenticatedRequest, res: Response) => {
  const { user_id } = req.params;
  const { password, role } = req.body;

  if (!password && !role) {
    return res.status(400).json({ error: 'Provide password or role to update.' });
  }

  try {
    const user = await queryOne('SELECT user_id, username, role FROM users WHERE user_id = $1', [user_id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (role) {
      const allowedRoles = ['Admin', 'Ops User', 'Viewer', 'Auditor', 'API User'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role.' });
      }
      
      // Safety guard: prevent admin from changing their own role to non-admin
      if (req.user?.user_id === user_id && role !== 'Admin') {
        return res.status(400).json({ error: 'You cannot downgrade your own Admin role.' });
      }

      await execute('UPDATE users SET role = $1 WHERE user_id = $2', [role, user_id]);

      // Add audit trail log for role change
      const auditId = uuidv4();
      await execute(
        `INSERT INTO document_audit_logs (audit_id, document_id, action, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          auditId,
          null,
          'User Role Update',
          JSON.stringify({ username: user.username, old_role: user.role }),
          JSON.stringify({ new_role: role }),
          req.user?.username || 'Admin'
        ]
      );
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }
      const hash = hashPassword(password);
      await execute('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, user_id]);
    }

    res.json({ message: 'User updated successfully.' });
  } catch (err: any) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

/**
 * DELETE /api/users/:user_id
 * Deletes a user profile
 */
router.delete('/:user_id', async (req: AuthenticatedRequest, res: Response) => {
  const { user_id } = req.params;

  if (req.user?.user_id === user_id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    const user = await queryOne('SELECT username FROM users WHERE user_id = $1', [user_id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Protect master admin from accidental deletion
    if (user.username === 'admin') {
      return res.status(400).json({ error: 'The default master admin account cannot be deleted.' });
    }

    await execute('DELETE FROM users WHERE user_id = $1', [user_id]);
    
    // Also clean up any active sessions for this user
    await execute('DELETE FROM user_sessions WHERE user_id = $1', [user_id]);

    res.json({ message: 'User deleted successfully.' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

export default router;
