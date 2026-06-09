import { getApiBaseUrl } from '../config';
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
  const [tripNos, setTripNos] = useState('');

  // Pagination State
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(1);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState({
    tripNo: true,
    primaryRef: true,
    docId: true,
    fileName: true,
    docType: true,
    vehicleNo: true,
    docDate: true,
    consignor: true,
    consignee: true,
    seal: true,
    sig: true,
    hndwrt: true,
    confidence: true,
    status: true,
  });
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);

  // Auto-search removed on page load as requested. Initial state is empty.
  // The search is run on explicit filter submit.

  const handleSearch = async (e?: React.FormEvent, pageNum = 1) => {
    if (e) e.preventDefault();
    setLoading(true);
    setPage(pageNum);

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
      if (status) params.append('status', status);
      if (tripNos) params.append('trip_nos', tripNos);
      params.append('page', pageNum.toString());
      params.append('limit', limit.toString());

      const res = await fetch(`${getApiBaseUrl()}/api/documents/search?${params.toString()}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      
      let filteredDocs = data.documents || [];
      if (status) {
        filteredDocs = filteredDocs.filter((d: any) => d.extraction_status.toLowerCase() === status.toLowerCase());
      }

      setDocuments(filteredDocs);
      setTotalResults(data.total_results || filteredDocs.length);
      setTotalPages(data.total_pages || Math.ceil(filteredDocs.length / limit) || 1);
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
    setTripNos('');
    setDocuments([]);
    setTotalResults(0);
    setPage(1);
    setTotalPages(1);
  };

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  // Reset selected IDs when documents list changes
  useEffect(() => {
    setSelectedDocIds([]);
  }, [documents]);

  const handleDownloadFile = (docId: string) => {
    window.open(`${getApiBaseUrl()}/api/documents/${docId}/download`, '_blank');
  };

  const handleDownloadJson = (docId: string) => {
    window.open(`${getApiBaseUrl()}/api/documents/${docId}/metadata/download`, '_blank');
  };

  const handleBatchDownload = async () => {
    if (selectedDocIds.length === 0) return;
    setDownloading(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/documents/batch-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_ids: selectedDocIds }),
      });

      if (!response.ok) {
        throw new Error('Batch download failed');
      }

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

  const handleBulkApprove = async () => {
    if (selectedDocIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to approve ${selectedDocIds.length} selected documents?`)) return;

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/documents/batch-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_ids: selectedDocIds }),
      });

      if (!res.ok) throw new Error('Bulk approval failed');
      alert(`Successfully approved ${selectedDocIds.length} documents.`);
      
      // Refresh search
      handleSearch(undefined, page);
    } catch (err: any) {
      console.error(err);
      alert('Failed to approve documents: ' + err.message);
    }
  };

  const handleExportCSV = () => {
    const docsToExport = selectedDocIds.length > 0
      ? documents.filter(d => selectedDocIds.includes(d.document_id))
      : documents;

    if (docsToExport.length === 0) {
      alert('No documents to export. Perform a search first.');
      return;
    }

    const headers = [
      'Trip No', 'Primary Ref No', 'Document ID', 'File Name', 
      'Document Type', 'Vehicle No', 'Doc Date', 'Consignor', 
      'Consignee', 'Seal Present', 'Signature Present', 'Handwriting Present', 
      'Confidence', 'Status'
    ];

    const rows = docsToExport.map(d => [
      d.trip_no || '',
      d.primary_reference_number || '',
      d.document_id,
      d.stored_file_name || d.original_file_name,
      d.document_type || '',
      d.vehicle_number || '',
      d.document_date || '',
      d.consignor_name || '',
      d.consignee_name || '',
      d.seal_detected ? 'Yes' : 'No',
      d.signature_detected ? 'Yes' : 'No',
      d.handwriting_detected ? 'Yes' : 'No',
      `${Math.round(d.confidence_score * 100)}%`,
      d.extraction_status
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scandoc_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    } catch (e) {
      return dateStr;
    }
  };

  const toggleColumn = (colName: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({
      ...prev,
      [colName]: !prev[colName]
    }));
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
        <form onSubmit={(e) => handleSearch(e, 1)}>
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
                <option value="Uploaded">Uploaded</option>
                <option value="Processing">Processing</option>
                <option value="Extracted">Extracted</option>
                <option value="Needs Review">Needs Review</option>
                <option value="Approved">Approved</option>
                <option value="Manually Approved">Manually Approved</option>
                <option value="Failed">Failed</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label>Trip Number(s) (comma separated)</label>
              <input type="text" placeholder="e.g. 5138819, 5139053" value={tripNos} onChange={(e) => setTripNos(e.target.value)} />
            </div>
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

      {/* Results Title & Toolbar */}
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 style={{ fontSize: '1.25rem', color: '#fff', margin: 0 }}>Results ({totalResults})</h3>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', position: 'relative' }}>
          {/* Column Toggler */}
          <button
            className="btn btn-secondary"
            onClick={() => setShowColumnDropdown(!showColumnDropdown)}
            style={{ fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            ⚙️ Columns
          </button>

          {showColumnDropdown && (
            <div style={{
              position: 'absolute',
              top: '40px',
              right: '250px',
              background: 'rgba(30, 30, 50, 0.95)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              zIndex: 100,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              width: '280px',
              backdropFilter: 'blur(10px)'
            }}>
              {Object.keys(visibleColumns).map((col) => {
                const colKey = col as keyof typeof visibleColumns;
                return (
                  <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={visibleColumns[colKey]}
                      onChange={() => toggleColumn(colKey)}
                    />
                    {colKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  </label>
                );
              })}
            </div>
          )}

          {/* Export CSV */}
          {documents.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={handleExportCSV}
              style={{ fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              📥 Export CSV
            </button>
          )}

          {/* Bulk Approve */}
          {selectedDocIds.length > 0 && (currentRole === 'Admin' || currentRole === 'Ops User') && (
            <button
              className="btn btn-secondary"
              onClick={handleBulkApprove}
              style={{ fontSize: '0.85rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            >
              ✅ Bulk Approve ({selectedDocIds.length})
            </button>
          )}

          {/* Bulk Download ZIP */}
          {selectedDocIds.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={handleBatchDownload}
              disabled={downloading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
            >
              {downloading ? '⚡ Preparing Zip...' : `📥 Download ZIP (${selectedDocIds.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Results Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <span className="spinner" style={{ fontSize: '2rem' }}>⚡</span>
          <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Searching database...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No documents found matching the search criteria. Please execute a search query.</p>
        </div>
      ) : (
        <>
          <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto', marginBottom: '16px' }}>
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
                  {visibleColumns.tripNo && <th>Trip No</th>}
                  {visibleColumns.primaryRef && <th>Primary Ref No</th>}
                  {visibleColumns.docId && <th>Document ID</th>}
                  {visibleColumns.fileName && <th>File Name</th>}
                  {visibleColumns.docType && <th>Document Type</th>}
                  {visibleColumns.vehicleNo && <th>Vehicle No</th>}
                  {visibleColumns.docDate && <th>Doc Date</th>}
                  {visibleColumns.consignor && <th>Consignor</th>}
                  {visibleColumns.consignee && <th>Consignee</th>}
                  {visibleColumns.seal && <th>Seal</th>}
                  {visibleColumns.sig && <th>Sig</th>}
                  {visibleColumns.hndwrt && <th>Hndwrt</th>}
                  {visibleColumns.confidence && <th>Confidence</th>}
                  {visibleColumns.status && <th>Status</th>}
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
                      {visibleColumns.tripNo && (
                        <td style={{ fontWeight: 600, color: 'var(--color-info)' }}>
                          {doc.trip_no || '-'}
                        </td>
                      )}
                      {visibleColumns.primaryRef && (
                        <td style={{ fontWeight: 600 }}>{doc.primary_reference_number || '-'}</td>
                      )}
                      {visibleColumns.docId && (
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {doc.document_id.slice(0, 8)}...
                        </td>
                      )}
                      {visibleColumns.fileName && (
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
                      )}
                      {visibleColumns.docType && <td>{doc.document_type || '-'}</td>}
                      {visibleColumns.vehicleNo && <td>{doc.vehicle_number || '-'}</td>}
                      {visibleColumns.docDate && <td>{formatDate(doc.document_date)}</td>}
                      {visibleColumns.consignor && (
                        <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.consignor_name}>
                          {doc.consignor_name || '-'}
                        </td>
                      )}
                      {visibleColumns.consignee && (
                        <td style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.consignee_name}>
                          {doc.consignee_name || '-'}
                        </td>
                      )}
                      {visibleColumns.seal && (
                        <td>
                          <span className={`tag-indicator ${doc.seal_detected ? 'tag-detected' : 'tag-absent'}`}>
                            {doc.seal_detected ? 'Yes' : 'No'}
                          </span>
                        </td>
                      )}
                      {visibleColumns.sig && (
                        <td>
                          <span className={`tag-indicator ${doc.signature_detected ? 'tag-detected' : 'tag-absent'}`}>
                            {doc.signature_detected ? 'Yes' : 'No'}
                          </span>
                        </td>
                      )}
                      {visibleColumns.hndwrt && (
                        <td>
                          <span className={`tag-indicator ${doc.handwriting_detected ? 'tag-detected' : 'tag-absent'}`}>
                            {doc.handwriting_detected ? 'Yes' : 'No'}
                          </span>
                        </td>
                      )}
                      {visibleColumns.confidence && (
                        <td style={{ fontWeight: 'bold', color: '#fff' }}>
                          {Math.round(doc.confidence_score * 100)}%
                        </td>
                      )}
                      {visibleColumns.status && (
                        <td>
                          <span className={getStatusClass(doc.extraction_status)}>
                            {doc.extraction_status}
                          </span>
                        </td>
                      )}
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                            onClick={() => onViewDocument(doc.document_id)}
                            title="View document review board"
                          >
                            👁️
                          </button>
                          {canEdit && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem', borderColor: 'var(--color-primary)' }}
                              onClick={() => onEditDocument(doc.document_id)}
                              title="Edit fields"
                            >
                              ✏️
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                            onClick={() => handleDownloadFile(doc.document_id)}
                            title={`Download file: ${doc.original_file_name}`}
                          >
                            📥
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                            onClick={() => handleDownloadJson(doc.document_id)}
                            title="Download parsed JSON file"
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

          {/* Pagination bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalResults} total results)
            </div>
            
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Page Size:
              </label>
              <select
                value={limit}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setLimit(val);
                  // Trigger search with new limit at page 1
                  setTimeout(() => {
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
                    if (status) params.append('status', status);
                    if (tripNos) params.append('trip_nos', tripNos);
                    params.append('page', '1');
                    params.append('limit', val.toString());
                    fetch(`${getApiBaseUrl()}/api/documents/search?${params.toString()}`)
                      .then(res => res.json())
                      .then(data => {
                        setPage(1);
                        setDocuments(data.documents || []);
                        setTotalResults(data.total_results || 0);
                        setTotalPages(data.total_pages || 1);
                      });
                  }, 50);
                }}
                style={{ width: '70px', padding: '4px 8px', fontSize: '0.85rem' }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>

              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => handleSearch(undefined, page - 1)}
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              >
                ◀ Prev
              </button>
              
              <button
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => handleSearch(undefined, page + 1)}
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              >
                Next ▶
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
