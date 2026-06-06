import { useState, useEffect } from 'react';

interface Document {
  document_id: string;
  original_file_name: string;
  stored_file_name: string;
  file_type: string;
  file_size_bytes: number;
  document_type: string | null;
  document_subtype: string | null;
  primary_reference_number: string | null;
  document_date: string | null;
  invoice_number: string | null;
  lr_number: string | null;
  consignment_note_number: string | null;
  vehicle_number: string | null;
  seal_detected: boolean;
  signature_detected: boolean;
  handwriting_detected: boolean;
  extraction_status: string;
  confidence_score: number;
}

interface BatchStatus {
  batch_id: string;
  status: string;
  total_documents: number;
  successful_documents: number;
  failed_documents: number;
  pending_documents: number;
}

interface BatchItem {
  batch_id: string;
  batch_name: string;
  uploaded_by: string;
  uploaded_at: string;
  total_documents: number;
  status: string;
}

interface ProcessingStatusProps {
  activeBatchId: string | null;
  currentRole: string;
  onViewDocument: (docId: string) => void;
  onEditDocument: (docId: string) => void;
  onSelectBatch: (batchId: string | null) => void;
}

export default function ProcessingStatus({
  activeBatchId,
  currentRole,
  onViewDocument,
  onEditDocument,
  onSelectBatch,
}: ProcessingStatusProps) {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [batchStats, setBatchStats] = useState<BatchStatus | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch recent batches if no activeBatchId is set
  useEffect(() => {
    if (!activeBatchId) {
      fetchBatches();
    }
  }, [activeBatchId]);

  // Polling logic when activeBatchId is selected and is still processing
  useEffect(() => {
    if (!activeBatchId) return;

    fetchBatchData();

    const interval = setInterval(() => {
      fetchBatchData(true); // silent fetch
    }, 2000);

    return () => clearInterval(interval);
  }, [activeBatchId]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      // We can query all documents or search batches. Since we don't have a direct batch search API,
      // we can query standard search or we'll fetch from a simple query.
      // Wait, is there a GET /api/document-batches endpoint? No, but let's query all audit logs or search
      // to see. Wait! We can add a GET /api/document-batches endpoint in api.ts to make batch list clean,
      // or we can fetch them. Let's add GET /api/document-batches to api.ts so the batch list is fully populated.
      const res = await fetch('http://localhost:3001/api/document-batches');
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
      } else {
        // Fallback if endpoint doesn't exist yet
        setBatches([]);
      }
    } catch (err) {
      console.error('Error fetching batches:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBatchData = async (silent = false) => {
    if (!activeBatchId) return;
    if (!silent) setLoading(true);

    try {
      // Fetch Stats
      const statsRes = await fetch(`http://localhost:3001/api/document-batches/${activeBatchId}/status`);
      if (!statsRes.ok) throw new Error('Failed to fetch batch status');
      const statsData = await statsRes.json();
      setBatchStats(statsData);

      // Fetch Documents
      const docsRes = await fetch(`http://localhost:3001/api/document-batches/${activeBatchId}/documents`);
      if (!docsRes.ok) throw new Error('Failed to fetch batch documents');
      const docsData = await docsRes.json();
      setDocuments(docsData);
      
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred loading batch data.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleDownloadFile = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/download`, '_blank');
  };

  const handleDownloadJson = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/metadata/download`, '_blank');
  };

  const getStatusClass = (status: string) => {
    const s = status.toLowerCase().replace(/\s/g, '');
    return `status-badge status-${s}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // If no batch is selected, show list of recent batches
  if (!activeBatchId) {
    return (
      <div>
        <h2 style={{ fontSize: '1.75rem', marginBottom: '24px', color: '#fff' }}>Processing Status</h2>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <span className="spinner" style={{ fontSize: '2rem' }}>⚡</span>
            <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Loading batches...</p>
          </div>
        ) : batches.length === 0 ? (
          <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
            <svg style={{ width: '48px', height: '48px', color: 'var(--text-muted)', marginBottom: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 style={{ color: '#fff', marginBottom: '8px' }}>No Batches Uploaded Yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Upload logistics documents in the Bulk Upload screen to see them process here.</p>
          </div>
        ) : (
          <div className="glass-panel" style={{ padding: '24px', overflowX: 'auto' }}>
            <h3 style={{ color: '#fff', marginBottom: '16px' }}>Select an Upload Batch to Monitor</h3>
            <table>
              <thead>
                <tr>
                  <th>Batch Name</th>
                  <th>Uploaded By</th>
                  <th>Uploaded At</th>
                  <th>Total Documents</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batch_id}>
                    <td style={{ fontWeight: 600, color: '#fff' }}>{b.batch_name}</td>
                    <td>{b.uploaded_by}</td>
                    <td>{new Date(b.uploaded_at).toLocaleString()}</td>
                    <td>{b.total_documents}</td>
                    <td>
                      <span className={getStatusClass(b.status)}>{b.status}</span>
                    </td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => onSelectBatch(b.batch_id)}>
                        Monitor Batch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const isBatchProcessing = batchStats?.status === 'Processing' || batchStats?.status === 'Uploaded';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.75rem', color: '#fff' }}>Batch Processing Status</h2>
        <button className="btn btn-secondary" onClick={() => onSelectBatch(null)}>
          Back to Batches
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--color-danger-bg)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {/* Stats Cards */}
      {batchStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '8px' }}>Batch Status</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span className={getStatusClass(batchStats.status)}>{batchStats.status}</span>
              {isBatchProcessing && <span className="spinner">⚡</span>}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '8px' }}>Total Documents</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#fff' }}>{batchStats.total_documents}</div>
          </div>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center', borderBottom: '2px solid var(--color-success)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '8px' }}>Successful / Extracted</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>{batchStats.successful_documents}</div>
          </div>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center', borderBottom: '2px solid var(--color-danger)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '8px' }}>Failed Extraction</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{batchStats.failed_documents}</div>
          </div>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center', borderBottom: '2px solid var(--color-info)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '8px' }}>Pending Queue</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-info)' }}>{batchStats.pending_documents}</div>
          </div>
        </div>
      )}

      {/* Documents Table */}
      {loading && documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <span className="spinner" style={{ fontSize: '2rem' }}>⚡</span>
          <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Loading batch details...</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '24px', overflowX: 'auto' }}>
          <h3 style={{ color: '#fff', marginBottom: '16px' }}>Documents in this Batch</h3>
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Doc Type</th>
                <th>Primary Ref No</th>
                <th>Vehicle No</th>
                <th>Doc Date</th>
                <th>Seal</th>
                <th>Sig</th>
                <th>Hndwrt</th>
                <th>Status</th>
                <th>Conf</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const canEdit = currentRole === 'Admin' || currentRole === 'Ops User';
                const statusLower = doc.extraction_status.toLowerCase();
                const isReady = statusLower === 'extracted' || statusLower === 'needs review' || statusLower === 'approved';

                return (
                  <tr key={doc.document_id}>
                    <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.original_file_name}>
                      <div style={{ fontWeight: 500, color: '#fff' }}>{doc.original_file_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatSize(doc.file_size_bytes)}</div>
                    </td>
                    <td>{doc.document_type || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                    <td style={{ fontWeight: 600 }}>{doc.primary_reference_number || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                    <td>{doc.vehicle_number || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                    <td>{doc.document_date ? new Date(doc.document_date).toLocaleDateString() : <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                    <td>
                      {doc.document_type ? (
                        <span className={`tag-indicator ${doc.seal_detected ? 'tag-detected' : 'tag-absent'}`}>
                          {doc.seal_detected ? 'Yes' : 'No'}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {doc.document_type ? (
                        <span className={`tag-indicator ${doc.signature_detected ? 'tag-detected' : 'tag-absent'}`}>
                          {doc.signature_detected ? 'Yes' : 'No'}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {doc.document_type ? (
                        <span className={`tag-indicator ${doc.handwriting_detected ? 'tag-detected' : 'tag-absent'}`}>
                          {doc.handwriting_detected ? 'Yes' : 'No'}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={getStatusClass(doc.extraction_status)}>{doc.extraction_status}</span>
                    </td>
                    <td style={{ fontWeight: 'bold' }}>
                      {doc.confidence_score > 0 ? `${Math.round(doc.confidence_score * 100)}%` : '-'}
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
                        {canEdit && isReady && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.75rem', borderColor: 'var(--color-primary)' }}
                            onClick={() => onEditDocument(doc.document_id)}
                            title="Edit metadata"
                          >
                            ✏️
                          </button>
                        )}
                        {isReady && (
                          <>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                              onClick={() => handleDownloadFile(doc.document_id)}
                              title="Download original file"
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
