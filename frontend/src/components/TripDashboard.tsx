import { getApiBaseUrl } from '../config';
import { useState, useEffect, useRef, Fragment } from 'react';

interface TripUpload {
  upload_id: string;
  file_name: string;
  record_count: number;
  uploaded_by: string;
  uploaded_at: string;
}

interface Trip {
  trip_id: string;
  upload_id: string;
  trip_no: number | null;
  trip_creation_date: string | null;
  trip_vehicle: string | null;
  destination: string | null;
  inv_no: string | null;
  lr_no: string | null;
  delivery_no_1: string | null;
  delivery_no_2: string | null;
  do_number: string | null;
  delivery_date: string | null;
  inv_date: string | null;
  inv_qty: number | null;
  uploaded_at: string;
}

interface TripDashboardProps {
  currentRole: string;
}

export default function TripDashboard({ currentRole }: TripDashboardProps) {
  const [uploads, setUploads] = useState<TripUpload[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const allowedExtensions = ['.xlsx', '.xls'];
  const maxFileSize = 15 * 1024 * 1024; // 15MB

  // Fetch all trips and uploads on mount
  useEffect(() => {
    fetchUploads();
    fetchTrips();
  }, [searchQuery]);

  const fetchUploads = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/trips/uploads`);
      if (res.ok) {
        const data = await res.json();
        setUploads(data);
      }
    } catch (err) {
      console.error('Failed to fetch upload audits:', err);
    }
  };

  const fetchTrips = async () => {
    try {
      const url = searchQuery.trim() 
        ? `${getApiBaseUrl()}/api/trips?search=${encodeURIComponent(searchQuery)}`
        : `${getApiBaseUrl()}/api/trips`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTrips(data);
        setCurrentPage(1); // Reset page to 1 on search
      }
    } catch (err) {
      console.error('Failed to fetch trip logs:', err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processUpload(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;
    await processUpload(droppedFile);
  };

  const processUpload = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setUploadError(`Unsupported file format: ${file.name}. Only Excel files (.xlsx, .xls) are allowed.`);
      return;
    }

    if (file.size > maxFileSize) {
      setUploadError(`File size exceeds 15MB limit: ${file.name}`);
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploaded_by', `${currentRole} User`);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/trips/upload`, {
        method: 'POST',
        headers: {
          'X-User-Role': currentRole,
        },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to parse and store trip spreadsheet.');
      }

      const result = await res.json();
      setUploadSuccess(`Successfully parsed "${result.file_name}" and stored ${result.record_count} trip logs!`);
      
      // Refresh data
      fetchUploads();
      fetchTrips();
    } catch (err: any) {
      setUploadError(err.message || 'An unexpected error occurred during upload.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteUpload = async (uploadId: string, fileName: string) => {
    if (!window.confirm(`Are you sure you want to delete the upload "${fileName}"?\nThis will remove all associated trip records from the database.`)) {
      return;
    }

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/trips/uploads/${uploadId}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentRole,
        },
      });

      if (res.ok) {
        setUploadSuccess(`Upload batch "${fileName}" deleted successfully.`);
        fetchUploads();
        fetchTrips();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to delete upload batch.');
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to delete upload batch.');
    }
  };

  const toggleExpandTrip = (tripId: string) => {
    if (expandedTripId === tripId) {
      setExpandedTripId(null);
    } else {
      setExpandedTripId(tripId);
    }
  };

  // Pagination calculation
  const indexOfLastTrip = currentPage * pageSize;
  const indexOfFirstTrip = indexOfLastTrip - pageSize;
  const currentTrips = trips.slice(indexOfFirstTrip, indexOfLastTrip);
  const totalPages = Math.ceil(trips.length / pageSize);

  const canUpload = currentRole === 'Admin' || currentRole === 'Ops User';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.75rem', color: '#fff', margin: 0 }}>Trip Logs Dashboard</h2>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Manage structured trip Excel databases & audit trails
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '24px' }}>
        
        {/* Left Column: Upload Component */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>Import Trip logs</h3>
          
          <div
            className={`upload-drop-zone ${isUploading ? 'pulse-glow' : ''}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => canUpload && fileInputRef.current?.click()}
            style={{ 
              opacity: canUpload ? 1 : 0.6, 
              pointerEvents: canUpload && !isUploading ? 'auto' : 'none',
              padding: '48px 16px'
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              accept=".xlsx,.xls"
            />
            
            {/* Excel Icon */}
            <svg style={{ width: '48px', height: '48px', color: '#10b981' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            
            <div style={{ fontWeight: 600, fontSize: '1.05rem', color: '#fff' }}>
              {isUploading ? 'Processing spreadsheet...' : 'Drag & drop Trip Excel here'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Supports .xlsx, .xls format up to 15MB
            </div>
            {canUpload && !isUploading && (
              <button className="btn btn-secondary" style={{ marginTop: '8px', fontSize: '0.85rem' }} type="button">
                Browse Excel File
              </button>
            )}
          </div>

          {/* Feedback Messages */}
          {uploadError && (
            <div style={{ padding: '12px 16px', background: 'var(--color-danger-bg)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
              ⚠️ {uploadError}
            </div>
          )}

          {uploadSuccess && (
            <div style={{ padding: '12px 16px', background: 'var(--color-success-bg)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)', fontSize: '0.85rem' }}>
              ✅ {uploadSuccess}
            </div>
          )}

          {!canUpload && (
            <div style={{ padding: '10px 14px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-sm)', color: '#fbbf24', fontSize: '0.8rem' }}>
              ⚠️ Only <strong>Admin</strong> and <strong>Ops User</strong> profiles can import Excel spreadsheets. Switch your role in the top header.
            </div>
          )}
        </div>

        {/* Right Column: Upload Audit History Logs */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>Upload History & Audit Log</h3>
          
          <div style={{ overflowY: 'auto', maxHeight: '250px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Record Count</th>
                  <th>Uploaded By</th>
                  <th>Timestamp</th>
                  {currentRole === 'Admin' && <th style={{ textAlign: 'center' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {uploads.length === 0 ? (
                  <tr>
                    <td colSpan={currentRole === 'Admin' ? 5 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      No upload history found in the database.
                    </td>
                  </tr>
                ) : (
                  uploads.map((up) => (
                    <tr key={up.upload_id}>
                      <td style={{ fontWeight: 500, color: '#fff' }}>{up.file_name}</td>
                      <td>
                        <span className="status-badge status-uploaded" style={{ fontSize: '0.7rem' }}>
                          {up.record_count} Rows
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{up.uploaded_by}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {new Date(up.uploaded_at).toLocaleString()}
                      </td>
                      {currentRole === 'Admin' && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleDeleteUpload(up.upload_id, up.file_name)}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              cursor: 'pointer', 
                              color: 'var(--color-danger)',
                              padding: '4px'
                            }}
                            title="Delete upload and associated trips"
                          >
                            {/* Trash Icon */}
                            <svg style={{ width: '18px', height: '18px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Panel: Trips Database Browse */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <h3 style={{ fontSize: '1.25rem', color: '#fff', margin: 0 }}>Browse Trip Database</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '400px' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder="Search vehicle, destination, invoice, or LR..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '36px' }}
              />
              <svg 
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: 'var(--text-muted)' }} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Trips Table */}
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
          <table style={{ minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Trip No</th>
                <th>Vehicle No</th>
                <th>Destination</th>
                <th>Invoice No</th>
                <th>LR No</th>
                <th style={{ textAlign: 'right' }}>Inv Qty (MT)</th>
                <th>Upload Audit Time</th>
              </tr>
            </thead>
            <tbody>
              {currentTrips.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '36px' }}>
                    No trip records match the criteria or database is empty.
                  </td>
                </tr>
              ) : (
                currentTrips.map((trip) => {
                  const isExpanded = expandedTripId === trip.trip_id;
                  return (
                    <Fragment key={trip.trip_id}>
                      <tr 
                        onClick={() => toggleExpandTrip(trip.trip_id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          {/* Chevron Icon */}
                          <svg 
                            style={{ 
                              width: '16px', 
                              height: '16px', 
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform var(--transition-fast)',
                              color: 'var(--text-muted)'
                            }} 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td style={{ fontWeight: 600, color: '#fff' }}>{trip.trip_no || '-'}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-info)' }}>
                            {trip.trip_vehicle || '-'}
                          </span>
                        </td>
                        <td>{trip.destination || '-'}</td>
                        <td>{trip.inv_no || '-'}</td>
                        <td>{trip.lr_no || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {trip.inv_qty !== null ? trip.inv_qty.toLocaleString(undefined, { minimumFractionDigits: 3 }) : '-'}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {new Date(trip.uploaded_at).toLocaleString()}
                        </td>
                      </tr>

                      {/* Expandable detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0 0 0 40px', background: 'rgba(255,255,255,0.015)' }}>
                            <div style={{ 
                              display: 'grid', 
                              gridTemplateColumns: 'repeat(4, 1fr)', 
                              gap: '16px', 
                              padding: '16px 24px', 
                              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                              fontSize: '0.85rem'
                            }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Trip Creation Date</span>
                                <strong style={{ color: '#fff' }}>{trip.trip_creation_date || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Delivery No 1</span>
                                <strong style={{ color: '#fff' }}>{trip.delivery_no_1 || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Delivery No 2</span>
                                <strong style={{ color: '#fff' }}>{trip.delivery_no_2 || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>DO (Delivery Order)</span>
                                <strong style={{ color: '#fff' }}>{trip.do_number || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Delivery Date</span>
                                <strong style={{ color: '#fff' }}>{trip.delivery_date || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Invoice Date</span>
                                <strong style={{ color: '#fff' }}>{trip.inv_date || '-'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Upload Audit Session ID</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {trip.upload_id}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Trip Database ID</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {trip.trip_id}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                width: '60px',
                padding: '4px 8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>entries</span>
            <span style={{ marginLeft: '12px' }}>
              (Showing {indexOfFirstTrip + 1} to {Math.min(indexOfLastTrip, trips.length)} of {trips.length} entries)
            </span>
          </div>
          {trips.length > pageSize && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
