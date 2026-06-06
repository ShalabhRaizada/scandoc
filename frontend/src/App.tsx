import { useState } from 'react';
import BulkUpload from './components/BulkUpload';
import ProcessingStatus from './components/ProcessingStatus';
import DocumentSearch from './components/DocumentSearch';
import DocumentReview from './components/DocumentReview';
import SemanticSearch from './components/SemanticSearch';

type ActiveTab = 'upload' | 'status' | 'search' | 'semantic';
type UserRole = 'Admin' | 'Ops User' | 'Viewer' | 'Auditor' | 'API User';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('upload');
  const [currentRole, setCurrentRole] = useState<UserRole>('Admin');
  
  // Drill-down Review State
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

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
        return 'Full Access (Upload, Review, Edit, Approve, Search, Download)';
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
            <button
              className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              📥 Bulk Upload
            </button>
            <button
              className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('status');
                // Don't clear activeBatchId so the user can go back to monitoring the selected batch
              }}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              📊 Processing Status
            </button>
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
          </nav>
        )}

        {/* Role Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right', display: 'none' /* hidden on small screens */ }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Current Profile</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <select
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value as UserRole)}
              style={{
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                borderColor: 'rgba(99, 102, 241, 0.3)',
                padding: '6px 12px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                width: '130px',
              }}
              title="Switch profile to test RBAC roles"
            >
              <option value="Admin">Admin</option>
              <option value="Ops User">Ops User</option>
              <option value="Viewer">Viewer</option>
              <option value="Auditor">Auditor</option>
              <option value="API User">API User</option>
            </select>
          </div>
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
          🔑 <strong>Role Permissions:</strong> {getRolePermissions(currentRole)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          Local time: {new Date().toLocaleTimeString()}
        </span>
      </div>

      {/* Main View Container */}
      <main style={{ flexGrow: 1, padding: '0 16px 32px 16px', display: 'flex', flexDirection: 'column' }}>
        <div className="container" style={{ width: '100%', maxWidth: '100%', flexGrow: 1 }}>
          {showReview && selectedDocId ? (
            <DocumentReview
              documentId={selectedDocId}
              currentRole={currentRole}
              onClose={() => {
                setShowReview(false);
                setSelectedDocId(null);
              }}
            />
          ) : (
            <>
              {activeTab === 'upload' && (
                <BulkUpload
                  currentRole={currentRole}
                  onUploadSuccess={handleUploadSuccess}
                />
              )}
              {activeTab === 'status' && (
                <ProcessingStatus
                  activeBatchId={activeBatchId}
                  currentRole={currentRole}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                  onSelectBatch={(batchId) => setActiveBatchId(batchId)}
                />
              )}
              {activeTab === 'search' && (
                <DocumentSearch
                  currentRole={currentRole}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                />
              )}
              {activeTab === 'semantic' && (
                <SemanticSearch
                  currentRole={currentRole}
                  onViewDocument={handleViewDocument}
                  onEditDocument={handleEditDocument}
                />
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
