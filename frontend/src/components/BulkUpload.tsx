import { useState, useRef } from 'react';

interface BulkUploadProps {
  currentRole: string;
  onUploadSuccess: (batchId: string) => void;
}

export default function BulkUpload({ currentRole, onUploadSuccess }: BulkUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [batchName, setBatchName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff'];
  const maxFileSize = 10 * 1024 * 1024; // 10MB
  const maxFiles = 10;

  const validateFiles = (newFiles: File[]): boolean => {
    const errors: string[] = [];
    const updatedFileList = [...files];

    // Max files check
    if (updatedFileList.length + newFiles.length > maxFiles) {
      errors.push('Maximum 10 files are allowed in one batch.');
    }

    newFiles.forEach((file) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      // Format check
      if (!allowedExtensions.includes(ext)) {
        errors.push(`Unsupported file format: ${file.name}. Only PDF, JPG, JPEG, PNG, WEBP, TIFF are allowed.`);
      }
      // Size check
      if (file.size > maxFileSize) {
        errors.push(`File size exceeds allowed limit (10MB): ${file.name}`);
      }
      if (file.size === 0) {
        errors.push(`Rejecting empty file: ${file.name}`);
      }
      // Duplicate check
      if (updatedFileList.some((f) => f.name === file.name)) {
        errors.push(`Duplicate file detected: ${file.name}`);
      }
    });

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (validateFiles(selected)) {
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    if (validateFiles(dropped)) {
      setFiles((prev) => [...prev, ...dropped]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setValidationErrors([]);
  };

  const handleReset = () => {
    setFiles([]);
    setBatchName('');
    setCustomerName('');
    setValidationErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setIsUploading(true);
    setValidationErrors([]);

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files[]', file);
    });
    formData.append('batch_name', batchName);
    formData.append('customer_name', customerName);
    formData.append('uploaded_by', `${currentRole} User`);

    try {
      // 1. Upload Batch
      const uploadRes = await fetch('http://localhost:3001/api/document-batches/upload', {
        method: 'POST',
        headers: {
          'X-User-Role': currentRole,
        },
        body: formData,
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        throw new Error(errData.error || 'Failed to upload documents.');
      }

      const uploadResult = await uploadRes.json();
      const batchId = uploadResult.batch_id;

      // 2. Start Extraction asynchronously
      const extractRes = await fetch(`http://localhost:3001/api/document-batches/${batchId}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Role': currentRole,
        },
        body: JSON.stringify({
          uploaded_by: `${currentRole} User`,
        }),
      });

      if (!extractRes.ok) {
        console.error('Failed to trigger background extraction.');
      }

      // Notify parent about success to switch tab and set active batch
      onUploadSuccess(batchId);
    } catch (err: any) {
      setValidationErrors([err.message || 'An unexpected error occurred.']);
    } finally {
      setIsUploading(false);
    }
  };

  const canUpload = files.length > 0 && !isUploading && (currentRole === 'Admin' || currentRole === 'Ops User');

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.75rem', marginBottom: '24px', color: '#fff' }}>Bulk Document Upload</h2>

      <div className="glass-panel" style={{ padding: '32px', marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          <div>
            <label htmlFor="batchName">Document Batch Name</label>
            <input
              id="batchName"
              type="text"
              placeholder="e.g. June_Steel_Logistics"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              disabled={isUploading}
            />
          </div>
          <div>
            <label htmlFor="customerName">Customer</label>
            <input
              id="customerName"
              type="text"
              placeholder="e.g. Tata Steel Limited"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isUploading}
            />
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          className="upload-drop-zone"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ opacity: isUploading ? 0.6 : 1, pointerEvents: isUploading ? 'none' : 'auto' }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            style={{ display: 'none' }}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff"
          />
          <svg style={{ width: '48px', height: '48px', color: 'var(--color-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>Drag & drop documents here</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Supports PDF, JPG, JPEG, PNG, WEBP, TIFF (Max 10 files, up to 10MB each)
          </div>
          <button className="btn btn-secondary" style={{ marginTop: '8px' }} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} type="button">
            Browse Files
          </button>
        </div>

        {/* Error Messages */}
        {validationErrors.length > 0 && (
          <div style={{ marginTop: '20px', padding: '12px 16px', background: 'var(--color-danger-bg)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-sm)' }}>
            {validationErrors.map((err, idx) => (
              <div key={idx} style={{ color: 'var(--color-danger)', fontSize: '0.875rem', display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' }}>
                <span style={{ fontWeight: 'bold' }}>•</span> {err}
              </div>
            ))}
          </div>
        )}

        {/* Selected Files List */}
        {files.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h4 style={{ fontSize: '1rem', color: '#fff', marginBottom: '12px' }}>Selected Files ({files.length}/10)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {files.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                    <svg style={{ width: '20px', height: '20px', color: 'var(--text-secondary)', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span style={{ fontSize: '0.875rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                  {!isUploading && (
                    <button
                      onClick={() => removeFile(idx)}
                      style={{ background: 'transparent', padding: '4px', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      title="Remove file"
                    >
                      <svg style={{ width: '18px', height: '18px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
          <button className="btn btn-secondary" onClick={handleReset} disabled={isUploading || files.length === 0}>
            Reset
          </button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={!canUpload}>
            {isUploading ? (
              <>
                <span className="spinner" style={{ marginRight: '8px' }}>⚡</span> Uploading & Extracting...
              </>
            ) : (
              'Upload & Extract'
            )}
          </button>
        </div>

        {/* Role Restriction warning */}
        {(currentRole !== 'Admin' && currentRole !== 'Ops User') && (
          <div style={{ marginTop: '20px', padding: '10px 14px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-sm)', color: '#fbbf24', fontSize: '0.875rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span> Only Admin and Ops User roles can upload documents. Switch your role in the top header to upload.
          </div>
        )}
      </div>
    </div>
  );
}
