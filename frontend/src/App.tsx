import { useState, useEffect } from 'react';
import BulkUpload from './components/BulkUpload';
import ProcessingStatus from './components/ProcessingStatus';
import DocumentSearch from './components/DocumentSearch';
import DocumentReview from './components/DocumentReview';
import SemanticSearch from './components/SemanticSearch';
import TripDashboard from './components/TripDashboard';
import Login from './components/Login';
import CostReport from './components/CostReport';
import AdminConsole from './components/AdminConsole';
import { getApiBaseUrl } from './config';

type ActiveTab = 'upload' | 'status' | 'search' | 'semantic' | 'trips' | 'reports' | 'admin';
type UserRole = 'Admin' | 'Ops User' | 'Viewer' | 'Auditor' | 'API User';

// Global Fetch Interceptor to automatically attach authorization header
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  const token = localStorage.getItem('scandoc_session');
  if (token) {
    const apiBase = getApiBaseUrl();
    const isApiRequest = typeof input === 'string' && (
      (apiBase && input.startsWith(apiBase)) || 
      input.startsWith('/api') || 
      input.startsWith('http://localhost:3001')
    );
    if (isApiRequest) {
      init = init || {};
      init.headers = init.headers || {};
      if (init.headers instanceof Headers) {
        init.headers.set('Authorization', `Bearer ${token}`);
      } else if (Array.isArray(init.headers)) {
        const headersMap = new Map(init.headers);
        headersMap.set('Authorization', `Bearer ${token}`);
        init.headers = Array.from(headersMap.entries());
      } else {
        (init.headers as any)['Authorization'] = `Bearer ${token}`;
      }
    }
  }
  return originalFetch(input, init);
};

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(localStorage.getItem('scandoc_session'));
  const [currentUser, setCurrentUser] = useState<{ username: string; role: UserRole } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('upload');
  
  // Drill-down Review State
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [systemStatus, setSystemStatus] = useState<string | null>(null);

  // Sync state from window location path
  const syncStateFromUrl = () => {
    const path = window.location.pathname;
    if (path.startsWith('/review/')) {
      const docId = path.substring(8);
      if (docId) {
        setSelectedDocId(docId);
        setShowReview(true);
        return;
      }
    }
    
    setShowReview(false);
    setSelectedDocId(null);

    const tab = path.substring(1) as ActiveTab;
    const validTabs: ActiveTab[] = ['upload', 'status', 'search', 'semantic', 'trips', 'reports', 'admin'];
    if (validTabs.includes(tab)) {
      setActiveTab(tab);
    } else {
      // If path is root or invalid, redirect to role default
      if (currentUser) {
        const defaultTab = (currentUser.role === 'Viewer' || currentUser.role === 'Auditor') ? 'search' : 'upload';
        setActiveTab(defaultTab);
        window.history.replaceState(null, '', `/${defaultTab}`);
      }
    }
  };

  const navigateTo = (path: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, '', path);
    } else {
      window.history.pushState(null, '', path);
    }
    syncStateFromUrl();
  };

  // Listen for browser back/forward buttons
  useEffect(() => {
    if (currentUser) {
      syncStateFromUrl();
      window.addEventListener('popstate', syncStateFromUrl);
    }
    return () => {
      window.removeEventListener('popstate', syncStateFromUrl);
    };
  }, [currentUser]);

  // Session activity tracker (15 minutes idle timeout)
  useEffect(() => {
    if (!sessionToken || !currentUser) return;

    let idleTimeout: any;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        alert('Your session has expired due to 15 minutes of inactivity. You will be logged out.');
        handleLogout();
      }, 15 * 60 * 1000);
    };

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach(event => {
      window.addEventListener(event, resetIdleTimer);
    });

    resetIdleTimer();

    return () => {
      clearTimeout(idleTimeout);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetIdleTimer);
      });
    };
  }, [sessionToken, currentUser]);

  const checkHealthStatus = async (token?: string) => {
    try {
      const activeToken = token || sessionToken;
      if (!activeToken) return;
      setSystemStatus('Checking...');
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${activeToken}`
      };
      const res = await originalFetch(`${getApiBaseUrl()}/api/auth/diagnostics`, { headers });
      if (!res.ok) {
        setSystemStatus('Revving Up');
        return;
      }
      const data = await res.json();
      
      const isDbHealthy = data.database?.connected === true && !data.database?.pg_init_error;
      const isGcsHealthy = !data.gcs?.enabled || data.gcs?.connected === true;
      const isGeminiHealthy = data.gemini?.test_call_success === true;
      
      if (isDbHealthy && isGcsHealthy && isGeminiHealthy) {
        setSystemStatus('Ready to Drive');
      } else {
        setSystemStatus('Revving Up');
      }
    } catch (err) {
      console.error('Diagnostics check failed:', err);
      setSystemStatus('Revving Up');
    }
  };

  // Verify session on app load
  useEffect(() => {
    const verifySession = async () => {
      if (!sessionToken) {
        setInitialLoading(false);
        return;
      }
      try {
        const res = await originalFetch(`${getApiBaseUrl()}/api/auth/me`, {
          headers: {
            'Authorization': `Bearer ${sessionToken}`
          }
        });
        const data = await res.json();
        if (res.ok && data.user) {
          setCurrentUser(data.user);
          checkHealthStatus(sessionToken);
        } else {
          localStorage.removeItem('scandoc_session');
          setSessionToken(null);
          setCurrentUser(null);
        }
      } catch (err) {
        console.error('Session verification failed:', err);
      } finally {
        setInitialLoading(false);
      }
    };
    verifySession();
  }, [sessionToken]);

  const handleLoginSuccess = (token: string, user: { user_id: string; username: string; role: string }) => {
    localStorage.setItem('scandoc_session', token);
    setSessionToken(token);
    setCurrentUser({ username: user.username, role: user.role as UserRole });
    checkHealthStatus(token);
  };

  const handleLogout = async () => {
    try {
      await originalFetch(`${getApiBaseUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`
        }
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    localStorage.removeItem('scandoc_session');
    setSessionToken(null);
    setCurrentUser(null);
    setSystemStatus(null);
    window.history.pushState(null, '', '/');
  };

  const handleUploadSuccess = (batchId: string) => {
    setActiveBatchId(batchId);
    navigateTo('/status');
  };

  const handleViewDocument = (docId: string) => {
    navigateTo(`/review/${docId}`);
  };

  const handleEditDocument = (docId: string) => {
    navigateTo(`/review/${docId}`);
  };

  const getRolePermissions = (role: UserRole) => {
    switch (role) {
      case 'Admin':
        return 'Full Access (Upload, Review, Edit, Approve, Search, Download, Admin Console)';
      case 'Ops User':
        return 'Operations (Upload, Review, Edit, Approve, Search, Download)';
      case 'Viewer':
        return 'Read-Only (Search and Download only)';
      case 'Auditor':
        return 'Auditing (Search, view audits, view JSON, download only)';
      case 'API User':
        return 'API Integrator (Access key tokens, query metadata)';
      default:
        return '';
    }
  };

  if (initialLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 10% 20%, rgb(18, 18, 32) 0%, rgb(8, 8, 16) 90%)', color: '#fff', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <span className="spinner" style={{ fontSize: '2.5rem' }}>⚡</span>
          <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Verifying session...</p>
        </div>
      </div>
    );
  }

  // Enforce Login view if unauthenticated
  if (!sessionToken || !currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Top Header Navbar */}
      <header
        className="glass-panel"
        style={{
          margin: '16px',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ 
              background: 'linear-gradient(135deg, #4ade80, #10b981)', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent' 
            }}>
              xTrAct
            </span>
          </span>
          <span style={{ fontSize: '0.75rem', padding: '3px 8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
            Logistics OCR Engine
          </span>
        </div>

        {/* Tab Links */}
        {!showReview && (
          <nav style={{ display: 'flex', gap: '4px' }}>
            {(currentUser.role === 'Admin' || currentUser.role === 'Ops User') && (
              <>
                <button
                  className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                  onClick={() => navigateTo('/upload')}
                  style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                  📥 Bulk Upload
                </button>
                <button
                  className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
                  onClick={() => navigateTo('/status')}
                  style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                  📊 Processing Status
                </button>
              </>
            )}
            <button
              className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => navigateTo('/search')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              🔍 Document Search
            </button>
            <button
              className={`tab-btn ${activeTab === 'semantic' ? 'active' : ''}`}
              onClick={() => navigateTo('/semantic')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              🧠 AI Semantic Search
            </button>
            {(currentUser.role === 'Admin' || currentUser.role === 'Ops User') && (
              <button
                className={`tab-btn ${activeTab === 'trips' ? 'active' : ''}`}
                onClick={() => navigateTo('/trips')}
                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
              >
                🚚 Trip Dashboard
              </button>
            )}
            <button
              className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => navigateTo('/reports')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              📈 Cost Report
            </button>
            {currentUser.role === 'Admin' && (
              <button
                className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => navigateTo('/admin')}
                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
              >
                🔑 Admin Console
              </button>
            )}
          </nav>
        )}

        {/* Profile Info and Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
              👤 {currentUser.username}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {currentUser.role}
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.35)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)';
            }}
          >
            Logout 🚪
          </button>
        </div>
      </header>

      {/* Permissions Indicator Bar */}
      <div
        style={{
          margin: '0 16px 16px 16px',
          padding: '8px 16px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          🔑 <strong>Role Permissions:</strong> {getRolePermissions(currentUser.role)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {systemStatus === 'Ready to Drive' && (
            <span style={{ 
              color: '#4ade80', 
              fontWeight: 600, 
              background: 'rgba(74, 222, 128, 0.1)', 
              padding: '2px 8px', 
              borderRadius: '4px',
              border: '1px solid rgba(74, 222, 128, 0.2)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span className="pulse-green" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
              Ready to Drive
            </span>
          )}
          {systemStatus === 'Revving Up' && (
            <span style={{ 
              color: '#fbbf24', 
              fontWeight: 600, 
              background: 'rgba(251, 191, 36, 0.1)', 
              padding: '2px 8px', 
              borderRadius: '4px',
              border: '1px solid rgba(251, 191, 36, 0.2)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span className="pulse-yellow" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
              Revving Up
            </span>
          )}
          {systemStatus === 'Checking...' && (
            <span style={{ color: 'var(--text-muted)' }}>
              Checking connection...
            </span>
          )}
          <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            • Session active
          </span>
        </div>
      </div>

      {/* Main View Container */}
      <main style={{ flexGrow: 1, padding: '0 16px 32px 16px', display: 'flex', flexDirection: 'column' }}>
        <div className="container" style={{ width: '100%', maxWidth: '100%', flexGrow: 1 }}>
          {showReview && selectedDocId ? (
            <DocumentReview
              documentId={selectedDocId}
              currentRole={currentUser.role}
              onClose={() => {
                navigateTo('/' + activeTab);
              }}
            />
          ) : (
            <>
              {activeTab === 'upload' && (
                <BulkUpload
                  currentRole={currentUser.role}
                  onUploadSuccess={handleUploadSuccess}
                />
              )}
              {activeTab === 'status' && (
                <ProcessingStatus
                  activeBatchId={activeBatchId}
                  currentRole={currentUser.role}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                  onSelectBatch={(batchId) => setActiveBatchId(batchId)}
                />
              )}
              {activeTab === 'search' && (
                <DocumentSearch
                  currentRole={currentUser.role}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                />
              )}
              {activeTab === 'semantic' && (
                <SemanticSearch
                  currentRole={currentUser.role}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                />
              )}
              {activeTab === 'trips' && (
                <TripDashboard
                  currentRole={currentUser.role}
                  onViewDocument={handleViewDocument}
                />
              )}
              {activeTab === 'reports' && (
                <CostReport />
              )}
              {activeTab === 'admin' && (
                <AdminConsole />
              )}
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer style={{ padding: '16px', borderTop: '1px solid var(--border-color)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        SCANDOC Logistics Document Processor • Powered by Gemini OCR Vision Engine • © 2026
      </footer>
    </div>
  );
}
