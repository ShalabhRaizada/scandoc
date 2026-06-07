import { useState, useEffect } from 'react';

interface DocumentSearchProps {
  currentRole: string;
  onViewDocument: (docId: string) => void;
  onEditDocument: (docId: string) => void;
}

export default function DocumentSearch({ currentRole, onViewDocument, onEditDocument }: DocumentSearchProps) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Search Form State
  const [q, setQ] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [consignorName, setConsignorName] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sealDetected, setSealDetected] = useState('');
  const [signatureDetected, setSignatureDetected] = useState('');
  const [handwritingDetected, setHandwritingDetected] = useState('');
  const [status, setStatus] = useState('');

  // Run initial search on mount
  useEffect(() => {
    handleSearch();
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (documentType) params.append('document_type', documentType);
      if (invoiceNumber) params.append('invoice_number', invoiceNumber);
      if (lrNumber) params.append('lr_number', lrNumber);
      if (vehicleNumber) params.append('vehicle_number', vehicleNumber);
      if (consignorName) params.append('consignor_name', consignorName);
      if (consigneeName) params.append('consignee_name', consigneeName);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (sealDetected) params.append('seal_detected', sealDetected);
      if (signatureDetected) params.append('signature_detected', signatureDetected);
      if (handwritingDetected) params.append('handwriting_detected', handwritingDetected);
      if (status) params.append('status', status); // Note: we'll handle status if needed, though search route handles it

      const res = await fetch(`http://localhost:3001/api/documents/search?${params.toString()}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      
      // Filter status locally if needed, or if API search filters it
      let filteredDocs = data.documents || [];
      if (status) {
        filteredDocs = filteredDocs.filter((d: any) => d.extraction_status.toLowerCase() === status.toLowerCase());
      }

      setDocuments(filteredDocs);
      setTotalResults(filteredDocs.length);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQ('');
    setDocumentType('');
    setInvoiceNumber('');
    setLrNumber('');
    setVehicleNumber('');
    setConsignorName('');
    setConsigneeName('');
    setDateFrom('');
    setDateTo('');
    setSealDetected('');
    setSignatureDetected('');
    setHandwritingDetected('');
    setStatus('');
    setDocuments([]);
    setTotalResults(0);
  };

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  // Reset selected IDs when documents list changes
  useEffect(() => {
    setSelectedDocIds([]);
  }, [documents]);

  const handleDownloadFile = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/download`, '_blank');
  };

  const handleDownloadJson = (docId: string) => {
    window.open(`http://localhost:3001/api/documents/${docId}/metadata/download`, '_blank');
  };

  const handleBatchDownload = async () => {
    if (selectedDocIds.length === 0) return;
    setDownloading(true);
    try {
      const response = await fetch('http://localhost:3001/api/documents/batch-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_ids: selectedDocIds }),
      });

      if (!response.ok) {
        throw new Error('Batch download failed');
      }

      // Convert response to blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scandoc_export_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert('Failed to download documents: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };


  const getStatusClass = (statusStr: string) => {
    const s = statusStr.toLowerCase().replace(/\s/g, '');
    return `status-badge status-${s}`;
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.75rem', marginBottom: '24px', color: '#fff' }}>Document Search</h2>

      {/* Filter panel */}
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <form onSubmit={handleSearch}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            
            {/* Free text */}
            <div style={{ gridColumn: 'span 2' }}>
              <label>Free Text Query (OCR Full Text Search)</label>
              <input
                type="text"
                placeholder="Search anything, e.g. TATA STEEL, MH14MT5353, coil code..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {/* Document Type */}
            <div>
              <label>Document Type</label>
              <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                <option value="">All Types</option>
                <option value="Invoice">Invoice / Tax Invoice</option>
                <option value="Lorry Receipt">Lorry Receipt (LR)</option>
                <option value="Proof of Delivery">Proof of Delivery (POD)</option>
                <option value="GRN">Goods Receipt Note (GRN)</option>
                <option value="E-way Bill">E-way Bill</option>
                <option value="Weighment Slip">Weighment Slip</option>
                <option value="Loading Slip">Loading Slip</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="Extracted">Extracted</option>
                <option value="Needs Review">Needs Review</option>
                <option value="Failed">Failed</option>
                <option value="Approved">Approved</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label>Invoice Number</label>
              <input type="text" placeholder="e.g. 300710276" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label>LR / CN Number</label>
              <input type="text" placeholder="e.g. R45013000523" value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} />
            </div>
            <div>
              <label>Vehicle Number</label>
              <input type="text" placeholder="e.g. MH14MT5353" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
            </div>
            <div>
              <label>Consignor Name</label>
              <input type="text" placeholder="e.g. Tata Steel" value={consignorName} onChange={(e) => setConsignorName(e.target.value)} />
            </div>
            <div>
              <label>Consignee Name</label>
              <input type="text" placeholder="e.g. Depot" value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '28px' }}>
            <div>
              <label>Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label>Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label>Seal Present</label>
              <select value={sealDetected} onChange={(e) => setSealDetected(e.target.value)}>
                <option value="">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <label>Signature Present</label>
              <select value={signatureDetected} onChange={(e) => setSignatureDetected(e.target.value)}>
                <option value="">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <label>Handwriting Present</label>
              <select value={handwritingDetected} onChange={(e) => setHandwritingDetected(e.target.value)}>
                <option value="">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn btn-secondary" type="button" onClick={handleClear}>
              Clear Filters
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Searching...' : '🔍 Search'}
            </button>
          </div>
        </form>
      </div>

      {/* Results Title */}
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Results ({totalResults})</h3>
        {selectedDocIds.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={handleBatchDownload}
            disabled={downloading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '0.875rem' }}
          >
            {downloading ? '⚡ Preparing Zip...' : `📥 Download Selected (${selectedDocIds.length})`}
          </button>
        )}
      </div>

      {/* Results Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <span className="spinner" style={{ fontSize: '2rem' }}>⚡</span>
          <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Searching database...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No documents found matching the search criteria.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={documents.length > 0 && selectedDocIds.length === documents.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDocIds(documents.map(d => d.document_id));
                      } else {
                        setSelectedDocIds([]);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th>Trip No</th>
                <th>Primary Ref No</th>
                <th>Document ID</th>
                <th>File Name</th>
                <th>Document Type</th>
                <th>Vehicle No</th>
                <th>Doc Date</th>
                <th>Consignor</th>
                <th>Consignee</th>
                <th>Seal</th>
                <th>Sig</th>
                <th>Hndwrt</th>
                <th>Confidence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const canEdit = currentRole === 'Admin' || currentRole === 'Ops User';
                
                return (
                  <tr key={doc.document_id}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(doc.document_id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDocIds(prev => [...prev, doc.document_id]);
                          } else {
                            setSelectedDocIds(prev => prev.filter(id => id !== doc.document_id));
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--color-info)' }}>
                      {doc.trip_no || '-'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{doc.primary_reference_number || '-'}</td>

                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {doc.document_id.slice(0, 8)}...
                    </td>
                    <td style={{ maxWidth: '180px' }} title={`Original: ${doc.original_file_name}`}>
                      <div style={{ fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.stored_file_name || doc.original_file_name}
                      </div>
                      {doc.stored_file_name && doc.stored_file_name !== doc.original_file_name && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.original_file_name}
                        </div>
                      )}
                    </td>
                    <td>{doc.document_type || '-'}</td>
                    <td>{doc.vehicle_number || '-'}</td>
                    <td>{doc.document_date ? new Date(doc.document_date).toLocaleDateString() : '-'}</td>
                    <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.consignor_name}>
                      {doc.consignor_name || '-'}
                    </td>
                    <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.consignee_name}>
                      {doc.consignee_name || '-'}
                    </td>
                    <td>
                      <span className={`tag-indicator ${doc.seal_detected ? 'tag-detected' : 'tag-absent'}`}>
                        {doc.seal_detected ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={`tag-indicator ${doc.signature_detected ? 'tag-detected' : 'tag-absent'}`}>
                        {doc.signature_detected ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={`tag-indicator ${doc.handwriting_detected ? 'tag-detected' : 'tag-absent'}`}>
                        {doc.handwriting_detected ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={getStatusClass(doc.extraction_status)}>
                        {Math.round(doc.confidence_score * 100)}%
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
    </div>
  );
}
