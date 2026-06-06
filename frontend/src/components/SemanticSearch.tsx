import { useState } from 'react';

interface SemanticSearchProps {
  currentRole: string;
  onViewDocument: (docId: string) => void;
  onEditDocument: (docId: string) => void;
}

export default function SemanticSearch({ currentRole, onViewDocument, onEditDocument }: SemanticSearchProps) {
  const [q, setQ] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const res = await fetch(`http://localhost:3001/api/documents/semantic-search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        throw new Error('Semantic search failed. Please try again.');
      }
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch results');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFile = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/download`, '_blank');
  };

  const handleDownloadJson = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/metadata/download`, '_blank');
  };

  const getSimilarityBadgeClass = (score: number) => {
    if (score >= 0.8) return 'similarity-high';
    if (score >= 0.5) return 'similarity-medium';
    return 'similarity-low';
  };

  const getStatusClass = (statusStr: string) => {
    const s = (statusStr || '').toLowerCase().replace(/\s/g, '');
    return `status-badge status-${s}`;
  };

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.75rem', color: '#fff', marginBottom: '8px' }}>🧠 AI Semantic Search</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Find documents concept-by-concept rather than exact keyword matches. Gemini text embedding calculates 
          the semantic distance between your query and document metadata.
        </p>
      </div>

      {/* Query Bar */}
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Enter Conceptual Query</label>
            <input
              type="text"
              placeholder="e.g. Search for Steel Coils dispatched in MH14 to depot consignees..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '1rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#fff',
              }}
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || !q.trim()}
            style={{
              padding: '12px 24px',
              fontSize: '1rem',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ margin: 0, fontSize: '1.1rem' }}>⚡</span> Searching...
              </>
            ) : (
              '⚡ Semantic Search'
            )}
          </button>
        </form>
      </div>

      {/* Error display */}
      {error && (
        <div className="glass-panel" style={{ padding: '16px', marginBottom: '24px', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' }}>
          <p style={{ color: '#f87171', margin: 0 }}>⚠️ {error}</p>
        </div>
      )}

      {/* Results Section */}
      {hasSearched && !loading && (
        <>
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Matched Documents ({documents.length})</h3>
          </div>

          {documents.length === 0 ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No documents found matching the conceptual context.</p>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Match Score</th>
                    <th>Document ID</th>
                    <th>File Name</th>
                    <th>Document Type</th>
                    <th>Primary Ref No</th>
                    <th>Vehicle No</th>
                    <th>Doc Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => {
                    const canEdit = currentRole === 'Admin' || currentRole === 'Ops User';
                    const scorePercent = Math.round((doc.similarity || 0) * 100);
                    
                    return (
                      <tr key={doc.document_id}>
                        <td>
                          <span className={`tag-indicator ${getSimilarityBadgeClass(doc.similarity || 0)}`} style={{ fontWeight: 'bold' }}>
                            {scorePercent}% Match
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {doc.document_id.slice(0, 8)}...
                        </td>
                        <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.original_file_name}>
                          <span style={{ fontWeight: 500, color: '#fff' }}>{doc.original_file_name}</span>
                        </td>
                        <td>{doc.document_type || '-'}</td>
                        <td style={{ fontWeight: 600 }}>{doc.primary_reference_number || '-'}</td>
                        <td>{doc.vehicle_number || '-'}</td>
                        <td>{doc.document_date ? new Date(doc.document_date).toLocaleDateString() : '-'}</td>
                        <td>
                          <span className={getStatusClass(doc.extraction_status)}>
                            {doc.extraction_status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                              onClick={() => onViewDocument(doc.document_id)}
                              title="View document"
                            >
                              👁️
                            </button>
                            {canEdit && (
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '6px 10px', fontSize: '0.75rem', borderColor: 'var(--color-primary)' }}
                                onClick={() => onEditDocument(doc.document_id)}
                                title="Edit metadata"
                              >
                                ✏️
                              </button>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                              onClick={() => handleDownloadFile(doc.document_id)}
                              title="Download original document"
                            >
                              📥
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                              onClick={() => handleDownloadJson(doc.document_id)}
                              title="Download JSON metadata"
                            >
                              JSON
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Styled badge styles local definition for high compatibility */}
      <style>{`
        .similarity-high {
          background: rgba(6, 182, 212, 0.2) !important;
          color: #22d3ee !important;
          border: 1px solid rgba(6, 182, 212, 0.4) !important;
        }
        .similarity-medium {
          background: rgba(245, 158, 11, 0.2) !important;
          color: #fbbf24 !important;
          border: 1px solid rgba(245, 158, 11, 0.4) !important;
        }
        .similarity-low {
          background: rgba(156, 163, 175, 0.2) !important;
          color: #d1d5db !important;
          border: 1px solid rgba(156, 163, 175, 0.4) !important;
        }
      `}</style>
    </div>
  );
}
