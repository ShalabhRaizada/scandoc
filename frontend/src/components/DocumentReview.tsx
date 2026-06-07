import { useState, useEffect } from 'react';

interface DocumentReviewProps {
  documentId: string;
  currentRole: string;
  onClose: () => void;
}

export default function DocumentReview({ documentId, currentRole, onClose }: DocumentReviewProps) {
  const [docData, setDocData] = useState<any>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'fields' | 'items' | 'tags' | 'json'>('fields');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetchMetadata();
  }, [documentId]);

  const fetchMetadata = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/documents/${documentId}/metadata`);
      if (!res.ok) throw new Error('Failed to fetch document metadata');
      const data = await res.json();
      setDocData(data);
      setMetadata(data.metadata_json || {});
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading document data');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (section: string, field: string, value: any) => {
    setMetadata((prev: any) => {
      const copy = { ...prev };
      if (!copy[section]) copy[section] = {};
      copy[section][field] = value;
      return copy;
    });
  };

  const handleTopLevelFieldChange = (field: string, value: any) => {
    setMetadata((prev: any) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Line item changes
  const handleLineItemChange = (index: number, field: string, value: any) => {
    setMetadata((prev: any) => {
      const copy = { ...prev };
      if (!copy.line_items) copy.line_items = [];
      const items = [...copy.line_items];
      items[index] = { ...items[index], [field]: value };
      
      // Auto-compute total values if weights / rates change
      if (field === 'net_weight_mt' || field === 'rate') {
        const net = parseFloat(items[index].net_weight_mt) || 0;
        const rate = parseFloat(items[index].rate) || 0;
        items[index].taxable_value = parseFloat((net * rate).toFixed(2));
        items[index].tax_amount = parseFloat((items[index].taxable_value * 0.18).toFixed(2)); // mock 18% GST
        items[index].total_value = parseFloat((items[index].taxable_value + items[index].tax_amount).toFixed(2));
      }
      
      copy.line_items = items;
      return copy;
    });
  };

  const addLineItem = () => {
    setMetadata((prev: any) => {
      const copy = { ...prev };
      const items = [...(copy.line_items || [])];
      items.push({
        line_number: items.length + 1,
        description: '',
        material_code: '',
        pieces_or_bundles: '',
        gross_weight_mt: 0.0,
        net_weight_mt: 0.0,
        rate: 0.0,
        taxable_value: 0.0,
        tax_amount: 0.0,
        total_value: 0.0,
      });
      copy.line_items = items;
      return copy;
    });
  };

  const deleteLineItem = (index: number) => {
    setMetadata((prev: any) => {
      const copy = { ...prev };
      const items = (copy.line_items || []).filter((_: any, i: number) => i !== index);
      // Re-index line numbers
      copy.line_items = items.map((item: any, idx: number) => ({ ...item, line_number: idx + 1 }));
      return copy;
    });
  };

  const handleSave = async (approve = false) => {
    setSaving(true);
    setSaveSuccess(false);
    setError(null);

    const payload = {
      metadata_json: {
        ...metadata,
        // Override extraction status if clicked Approve
        extraction_status: approve ? 'Approved' : metadata.extraction_status,
      },
    };

    try {
      const res = await fetch(`http://localhost:3001/api/documents/${documentId}/metadata`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Role': currentRole,
          'X-User': `${currentRole} User`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update metadata');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      // Reload metadata
      await fetchMetadata();
      
      if (approve) {
        onClose(); // Auto-close on approval
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error saving changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadFile = () => {
    if (!docData) return;
    window.open(`http://localhost:3001/api/documents/${documentId}/download`, '_blank');
  };

  const handleDownloadJson = () => {
    if (!docData) return;
    window.open(`http://localhost:3001/api/documents/${documentId}/metadata/download`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <span className="spinner" style={{ fontSize: '2.5rem' }}>⚡</span>
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading document details...</p>
      </div>
    );
  }

  const isEditable = currentRole === 'Admin' || currentRole === 'Ops User';
  const fileUrl = docData ? `http://localhost:3001/uploads/${docData.stored_file_name}` : '';
  const isPdf = docData?.file_type?.toLowerCase() === 'pdf';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '1.5rem', color: '#fff', margin: 0 }}>
              Review: {docData.stored_file_name || docData.original_file_name}
            </h2>
            <span className={`status-badge status-${docData.extraction_status.toLowerCase().replace(/\s/g, '')}`} style={{ margin: 0 }}>
              {docData.extraction_status}
            </span>
          </div>
          {docData.stored_file_name && docData.stored_file_name !== docData.original_file_name && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Original file: {docData.original_file_name}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleDownloadFile}>
            📥 Download File
          </button>
          <button className="btn btn-secondary" onClick={handleDownloadJson}>
            JSON
          </button>
          <button className="btn btn-secondary" style={{ borderColor: 'rgba(255,255,255,0.2)' }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--color-danger-bg)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--color-danger)', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {saveSuccess && (
        <div style={{ padding: '12px 16px', background: 'var(--color-success-bg)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--color-success)', marginBottom: '20px', fontWeight: 600 }}>
          ✓ Metadata saved successfully and stored file renamed!
        </div>
      )}

      {/* Split Layout Container */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', height: 'calc(100vh - 200px)', minHeight: '600px' }}>
        
        {/* Left Side: Document Preview */}
        <div className="glass-panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Original Document Preview ({docData.file_type.toUpperCase()})</span>
            <a href={fileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
              Open in new tab ↗
            </a>
          </div>
          <div style={{ flexGrow: 1, background: '#1e293b', borderRadius: 'var(--radius-sm)', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {isPdf ? (
              <iframe
                src={fileUrl}
                title="PDF Preview"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            ) : (
              <img
                src={fileUrl}
                alt="Document visual"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            )}
          </div>
        </div>

        {/* Right Side: Form Panel */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* Tabs */}
          <div className="tab-container" style={{ margin: '0', padding: '12px 20px 0 20px', background: 'rgba(0,0,0,0.1)' }}>
            <button className={`tab-btn ${activeTab === 'fields' ? 'active' : ''}`} onClick={() => setActiveTab('fields')}>
              Fields
            </button>
            <button className={`tab-btn ${activeTab === 'items' ? 'active' : ''}`} onClick={() => setActiveTab('items')}>
              Line Items ({metadata.line_items?.length || 0})
            </button>
            <button className={`tab-btn ${activeTab === 'tags' ? 'active' : ''}`} onClick={() => setActiveTab('tags')}>
              Visual Tags
            </button>
            <button className={`tab-btn ${activeTab === 'json' ? 'active' : ''}`} onClick={() => setActiveTab('json')}>
              Raw JSON
            </button>
          </div>

          {/* Form Scroll Area */}
          <div style={{ flexGrow: 1, overflowY: 'auto', padding: '24px' }}>
            
            {/* TAB 1: Fields */}
            {activeTab === 'fields' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* General Metadata */}
                <div>
                  <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '16px' }}>
                    Common Metadata
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label>Document Type</label>
                      <input
                        type="text"
                        value={metadata.document_type || ''}
                        onChange={(e) => handleTopLevelFieldChange('document_type', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Document Subtype</label>
                      <input
                        type="text"
                        value={metadata.document_subtype || ''}
                        onChange={(e) => handleTopLevelFieldChange('document_subtype', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Document Date</label>
                      <input
                        type="date"
                        value={metadata.document_date || ''}
                        onChange={(e) => handleTopLevelFieldChange('document_date', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Primary Reference Number</label>
                      <input
                        type="text"
                        value={metadata.primary_reference_number || ''}
                        onChange={(e) => handleTopLevelFieldChange('primary_reference_number', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                  </div>
                </div>

                {/* Logistics */}
                <div>
                  <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '16px' }}>
                    Logistics Details
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label>Vehicle Number</label>
                      <input
                        type="text"
                        value={metadata.logistics?.vehicle_number || ''}
                        onChange={(e) => handleFieldChange('logistics', 'vehicle_number', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Consignment Note / LR Number</label>
                      <input
                        type="text"
                        value={metadata.logistics?.consignment_note_number || metadata.logistics?.lr_number || ''}
                        onChange={(e) => {
                          handleFieldChange('logistics', 'consignment_note_number', e.target.value);
                          handleFieldChange('logistics', 'lr_number', e.target.value);
                        }}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Delivery Number</label>
                      <input
                        type="text"
                        value={metadata.logistics?.delivery_number || ''}
                        onChange={(e) => handleFieldChange('logistics', 'delivery_number', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>GST Invoice Number</label>
                      <input
                        type="text"
                        value={metadata.logistics?.gst_invoice_number || metadata.logistics?.invoice_number || ''}
                        onChange={(e) => {
                          handleFieldChange('logistics', 'gst_invoice_number', e.target.value);
                          handleFieldChange('logistics', 'invoice_number', e.target.value);
                        }}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>E-way Bill Number</label>
                      <input
                        type="text"
                        value={metadata.logistics?.eway_bill_number || ''}
                        onChange={(e) => handleFieldChange('logistics', 'eway_bill_number', e.target.value)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Plant / Vendor Code</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          placeholder="Plant"
                          value={metadata.logistics?.plant_code || ''}
                          onChange={(e) => handleFieldChange('logistics', 'plant_code', e.target.value)}
                          disabled={!isEditable}
                        />
                        <input
                          type="text"
                          placeholder="Vendor"
                          value={metadata.logistics?.vendor_code || ''}
                          onChange={(e) => handleFieldChange('logistics', 'vendor_code', e.target.value)}
                          disabled={!isEditable}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Parties */}
                <div>
                  <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '16px' }}>
                    Parties Details
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label>Consignor Name</label>
                      <input
                        type="text"
                        value={metadata.parties?.consignor?.name || ''}
                        onChange={(e) => handleFieldChange('parties', 'consignor', { ...metadata.parties?.consignor, name: e.target.value })}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Consignee Name</label>
                      <input
                        type="text"
                        value={metadata.parties?.consignee?.name || ''}
                        onChange={(e) => handleFieldChange('parties', 'consignee', { ...metadata.parties?.consignee, name: e.target.value })}
                        disabled={!isEditable}
                      />
                    </div>
                    <div>
                      <label>Transporter Name</label>
                      <input
                        type="text"
                        value={metadata.parties?.transporter?.name || ''}
                        onChange={(e) => handleFieldChange('parties', 'transporter', { ...metadata.parties?.transporter, name: e.target.value })}
                        disabled={!isEditable}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Line Items */}
            {activeTab === 'items' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1rem', color: '#fff' }}>Extracted Line Items</h3>
                  {isEditable && (
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={addLineItem}>
                      + Add Item
                    </button>
                  )}
                </div>

                {(!metadata.line_items || metadata.line_items.length === 0) ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No line items extracted.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {metadata.line_items.map((item: any, idx: number) => (
                      <div key={idx} className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.875rem' }}>Line Item #{item.line_number}</span>
                          {isEditable && (
                            <button
                              onClick={() => deleteLineItem(idx)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Description</label>
                            <input
                              type="text"
                              value={item.description || ''}
                              onChange={(e) => handleLineItemChange(idx, 'description', e.target.value)}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Material Code</label>
                            <input
                              type="text"
                              value={item.material_code || ''}
                              onChange={(e) => handleLineItemChange(idx, 'material_code', e.target.value)}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Bundles/Qty</label>
                            <input
                              type="text"
                              value={item.pieces_or_bundles || ''}
                              onChange={(e) => handleLineItemChange(idx, 'pieces_or_bundles', e.target.value)}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Gross Wt (MT)</label>
                            <input
                              type="number"
                              step="0.001"
                              value={item.gross_weight_mt || 0}
                              onChange={(e) => handleLineItemChange(idx, 'gross_weight_mt', parseFloat(e.target.value))}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Net Wt (MT)</label>
                            <input
                              type="number"
                              step="0.001"
                              value={item.net_weight_mt || 0}
                              onChange={(e) => handleLineItemChange(idx, 'net_weight_mt', parseFloat(e.target.value))}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Rate (INR)</label>
                            <input
                              type="number"
                              value={item.rate || 0}
                              onChange={(e) => handleLineItemChange(idx, 'rate', parseFloat(e.target.value))}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Total Value</label>
                            <div style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600, paddingTop: '8px' }}>
                              {item.total_value ? `₹${item.total_value.toLocaleString()}` : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Visual Tags */}
            {activeTab === 'tags' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '1rem', color: '#fff', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                  AI Visual Detection Checklist
                </h3>
                
                {/* Seal Tag */}
                <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={metadata.visual_tags?.seal_detected || false}
                    onChange={(e) => handleFieldChange('visual_tags', 'seal_detected', e.target.checked)}
                    disabled={!isEditable}
                    style={{ width: '20px', height: '20px', marginTop: '2px', cursor: isEditable ? 'pointer' : 'default' }}
                  />
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontWeight: 600, color: '#fff' }}>Seal / Stamp Detected</div>
                    {metadata.visual_tags?.seal_detected && (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem' }}>Seal Text</label>
                          <input
                            type="text"
                            value={metadata.visual_tags.seal_text || ''}
                            onChange={(e) => handleFieldChange('visual_tags', 'seal_text', e.target.value)}
                            disabled={!isEditable}
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Location Description</label>
                            <input
                              type="text"
                              value={metadata.visual_tags.seal_location || ''}
                              onChange={(e) => handleFieldChange('visual_tags', 'seal_location', e.target.value)}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.75rem' }}>Confidence</label>
                            <input
                              type="number"
                              step="0.01"
                              value={metadata.visual_tags.seal_confidence || 0}
                              onChange={(e) => handleFieldChange('visual_tags', 'seal_confidence', parseFloat(e.target.value))}
                              disabled={!isEditable}
                              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Signature Tag */}
                <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={metadata.visual_tags?.signature_detected || false}
                    onChange={(e) => handleFieldChange('visual_tags', 'signature_detected', e.target.checked)}
                    disabled={!isEditable}
                    style={{ width: '20px', height: '20px', marginTop: '2px', cursor: isEditable ? 'pointer' : 'default' }}
                  />
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontWeight: 600, color: '#fff' }}>Signature Detected</div>
                    {metadata.visual_tags?.signature_detected && (
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem' }}>Location Description</label>
                          <input
                            type="text"
                            value={metadata.visual_tags.signature_location || ''}
                            onChange={(e) => handleFieldChange('visual_tags', 'signature_location', e.target.value)}
                            disabled={!isEditable}
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem' }}>Confidence</label>
                          <input
                            type="number"
                            step="0.01"
                            value={metadata.visual_tags.signature_confidence || 0}
                            onChange={(e) => handleFieldChange('visual_tags', 'signature_confidence', parseFloat(e.target.value))}
                            disabled={!isEditable}
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Handwriting Tag */}
                <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={metadata.visual_tags?.handwriting_detected || false}
                    onChange={(e) => handleFieldChange('visual_tags', 'handwriting_detected', e.target.checked)}
                    disabled={!isEditable}
                    style={{ width: '20px', height: '20px', marginTop: '2px', cursor: isEditable ? 'pointer' : 'default' }}
                  />
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontWeight: 600, color: '#fff' }}>Handwritten Notes / Date / Truck Number Detected</div>
                    
                    {metadata.visual_tags?.handwriting_detected && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        
                        {/* List of handwritten fields */}
                        {metadata.visual_tags.handwritten_fields?.map((field: any, idx: number) => (
                          <div key={idx} style={{ padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                            <div style={{ fontWeight: 600, color: '#91a3b0', fontSize: '0.8rem', marginBottom: '6px' }}>
                              Field: {field.field_name}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '8px' }}>
                              <div>
                                <label style={{ fontSize: '0.7rem' }}>Value</label>
                                <input
                                  type="text"
                                  value={field.value || ''}
                                  onChange={(e) => {
                                    const fields = [...metadata.visual_tags.handwritten_fields];
                                    fields[idx].value = e.target.value;
                                    handleFieldChange('visual_tags', 'handwritten_fields', fields);
                                  }}
                                  disabled={!isEditable}
                                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '0.7rem' }}>Location</label>
                                <input
                                  type="text"
                                  value={field.location || ''}
                                  onChange={(e) => {
                                    const fields = [...metadata.visual_tags.handwritten_fields];
                                    fields[idx].location = e.target.value;
                                    handleFieldChange('visual_tags', 'handwritten_fields', fields);
                                  }}
                                  disabled={!isEditable}
                                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '0.7rem' }}>Conf</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={field.confidence || 0}
                                  onChange={(e) => {
                                    const fields = [...metadata.visual_tags.handwritten_fields];
                                    fields[idx].confidence = parseFloat(e.target.value);
                                    handleFieldChange('visual_tags', 'handwritten_fields', fields);
                                  }}
                                  disabled={!isEditable}
                                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Review Flags Warnings */}
                {metadata.review_flags?.length > 0 && (
                  <div style={{ padding: '12px 16px', background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ color: '#fbbf24', fontWeight: 600, fontSize: '0.85rem', marginBottom: '8px' }}>⚠️ Active Review Flags:</div>
                    {metadata.review_flags.map((flag: string, idx: number) => (
                      <div key={idx} style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', paddingLeft: '8px' }}>
                        • {flag}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Raw JSON Preview */}
            {activeTab === 'json' && (
              <div style={{ height: '100%' }}>
                <pre
                  style={{
                    background: '#090d16',
                    padding: '16px',
                    borderRadius: 'var(--radius-sm)',
                    color: '#818cf8',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    overflow: 'auto',
                    maxHeight: '400px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {JSON.stringify(metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          {isEditable && (
            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving} style={{ background: 'var(--color-success)' }}>
                {saving ? 'Processing...' : 'Approve Document'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
