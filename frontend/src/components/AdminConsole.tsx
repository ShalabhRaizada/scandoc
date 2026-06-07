import React, { useState, useEffect } from 'react';

interface User {
  user_id: string;
  username: string;
  role: string;
  created_at: string;
}

export default function AdminConsole() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('Viewer');
  const [creating, setCreating] = useState(false);

  // Edit State
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('');
  const [updating, setUpdating] = useState(false);

  const getSessionToken = () => localStorage.getItem('scandoc_session') || '';

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3001/api/users', {
        headers: {
          'Authorization': `Bearer ${getSessionToken()}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load users.');
      }
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword || !newRole) {
      setError('Please fill in all fields.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('http://localhost:3001/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSessionToken()}`
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user.');
      }

      setSuccess(`User '${newUsername}' created successfully.`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('Viewer');
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    if (editPassword && editPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setUpdating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`http://localhost:3001/api/users/${editingUserId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSessionToken()}`
        },
        body: JSON.stringify({
          password: editPassword || undefined,
          role: editRole
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user.');
      }

      setSuccess('User updated successfully.');
      setEditingUserId(null);
      setEditPassword('');
      setEditRole('');
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Are you sure you want to delete user '${username}'?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`http://localhost:3001/api/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${getSessionToken()}`
        }
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user.');
      }

      setSuccess(`User '${username}' deleted successfully.`);
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEdit = (user: User) => {
    setEditingUserId(user.user_id);
    setEditRole(user.role);
    setEditPassword('');
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setEditRole('');
    setEditPassword('');
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'Admin': return 'status-badge status-approved';
      case 'Ops User': return 'status-badge';
      case 'Viewer': return 'status-badge status-manuallyapproved';
      case 'Auditor': return 'status-badge status-needsreview';
      default: return 'status-badge';
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.75rem', marginBottom: '8px', color: '#fff' }}>Admin Console</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
        Create, edit, and manage user accounts and application permission roles.
      </p>

      {error && (
        <div className="glass-panel" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171', marginBottom: '20px' }}>
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div className="glass-panel" style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', color: '#34d399', marginBottom: '20px' }}>
          ✅ {success}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Side: Users List */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', color: '#fff' }}>Registered Users</h3>
          
          {loading && users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <span className="spinner">⚡</span> Loading accounts...
            </div>
          ) : (
            <table className="docs-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Assigned Role</th>
                  <th>Created At</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td style={{ fontWeight: 600, color: '#fff' }}>{user.username}</td>
                    <td>
                      <span className={getRoleBadgeClass(user.role)}>
                        {user.role}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => startEdit(user)}
                          className="action-btn"
                          title="Edit User"
                          style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                        >
                          ✏️ Edit
                        </button>
                        {user.username !== 'admin' && (
                          <button
                            onClick={() => handleDeleteUser(user.user_id, user.username)}
                            className="action-btn"
                            title="Delete User"
                            style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right Side: Manage Form */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          {editingUserId ? (
            /* Update User Form */
            <form onSubmit={handleUpdateUser}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', color: '#fff' }}>Update User Settings</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px' }}
                  >
                    <option value="Admin">Admin</option>
                    <option value="Ops User">Ops User</option>
                    <option value="Viewer">Viewer</option>
                    <option value="Auditor">Auditor</option>
                    <option value="API User">API User</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>
                    New Password (leave blank to keep current)
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="submit"
                    className="save-btn"
                    disabled={updating}
                    style={{ flexGrow: 1 }}
                  >
                    {updating ? 'Saving...' : 'Update User'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="action-btn"
                    style={{ padding: '10px 16px' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Create User Form */
            <form onSubmit={handleCreateUser}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', color: '#fff' }}>Create User Account</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>Username</label>
                  <input
                    type="text"
                    placeholder="e.g. john_doe"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px' }}
                  >
                    <option value="Admin">Admin</option>
                    <option value="Ops User">Ops User</option>
                    <option value="Viewer">Viewer</option>
                    <option value="Auditor">Auditor</option>
                    <option value="API User">API User</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="save-btn"
                  disabled={creating}
                  style={{ marginTop: '8px' }}
                >
                  {creating ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
