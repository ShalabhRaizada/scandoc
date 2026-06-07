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

type ActiveTab = 'upload' | 'status' | 'search' | 'semantic' | 'trips' | 'reports' | 'admin';
type UserRole = 'Admin' | 'Ops User' | 'Viewer' | 'Auditor' | 'API User';

// Global Fetch Interceptor to automatically attach authorization header
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  const token = localStorage.getItem('scandoc_session');
  if (token) {
    const isApiRequest = typeof input === 'string' && (input.startsWith('http://localhost:3001') || input.startsWith('/api'));
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

  // Verify session on app load
  useEffect(() => {
    const verifySession = async () => {
      if (!sessionToken) {
        setInitialLoading(false);
        return;
      }
      try {
        const res = await originalFetch('http://localhost:3001/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${sessionToken}`
          }
        });
        const data = await res.json();
        if (res.ok && data.user) {
          setCurrentUser(data.user);
          // Set default landing tab based on role permissions
          if (data.user.role === 'Viewer' || data.user.role === 'Auditor') {
            setActiveTab('search');
          } else {
            setActiveTab('upload');
          }
        } else {
          // Invalid session, clear state
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
    if (user.role === 'Viewer' || user.role === 'Auditor') {
      setActiveTab('search');
    } else {
      setActiveTab('upload');
    }
  };

  const handleLogout = async () => {
    try {
      await originalFetch('http://localhost:3001/api/auth/logout', {
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
  };

  const handleUploadSuccess = (batchId: string) => {
    setActiveBatchId(batchId);
    setActiveTab('status'); // Switch to status tab automatically
  };

  const handleViewDocument = (docId: string) => {
    setSelectedDocId(docId);
    setShowReview(true);
  };

  const handleEditDocument = (docId: string) => {
    setSelectedDocId(docId);
    setShowReview(true);
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
            <span style={{ color: 'var(--color-primary)' }}>⚡</span> SCANDOC
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
                  onClick={() => setActiveTab('upload')}
                  style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                  📥 Bulk Upload
                </button>
                <button
                  className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
                  onClick={() => setActiveTab('status')}
                  style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                  📊 Processing Status
                </button>
              </>
            )}
            <button
              className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              🔍 Document Search
            </button>
            <button
              className={`tab-btn ${activeTab === 'semantic' ? 'active' : ''}`}
              onClick={() => setActiveTab('semantic')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              🧠 AI Semantic Search
            </button>
            {(currentUser.role === 'Admin' || currentUser.role === 'Ops User') && (
              <button
                className={`tab-btn ${activeTab === 'trips' ? 'active' : ''}`}
                onClick={() => setActiveTab('trips')}
                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
              >
                🚚 Trip Dashboard
              </button>
            )}
            <button
              className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveTab('reports')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              📈 Cost Report
            </button>
            {currentUser.role === 'Admin' && (
              <button
                className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
              >
                ⚙️ Admin Console
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
        <span style={{ color: 'var(--text-muted)' }}>
          Session active
        </span>
      </div>

      {/* Main View Container */}
      <main style={{ flexGrow: 1, padding: '0 16px 32px 16px', display: 'flex', flexDirection: 'column' }}>
        <div className="container" style={{ width: '100%', maxWidth: '100%', flexGrow: 1 }}>
          {showReview && selectedDocId ? (
            <DocumentReview
              documentId={selectedDocId}
              currentRole={currentUser.role}
              onClose={() => {
                setShowReview(false);
                setSelectedDocId(null);
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
