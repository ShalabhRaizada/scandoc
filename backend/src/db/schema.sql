-- Table: document_batches
CREATE TABLE IF NOT EXISTS document_batches (
    batch_id UUID PRIMARY KEY,
    batch_name VARCHAR(255),
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_documents INTEGER,
    successful_documents INTEGER DEFAULT 0,
    failed_documents INTEGER DEFAULT 0,
    status VARCHAR(50)
);

-- Table: documents
CREATE TABLE IF NOT EXISTS documents (
    document_id UUID PRIMARY KEY,
    batch_id UUID REFERENCES document_batches(batch_id),
    original_file_name VARCHAR(500),
    stored_file_name VARCHAR(500),
    file_path TEXT,
    file_type VARCHAR(50),
    file_size_bytes BIGINT,
    document_type VARCHAR(100),
    document_subtype VARCHAR(100),
    primary_reference_number VARCHAR(100),
    document_date DATE,
    invoice_number VARCHAR(100),
    lr_number VARCHAR(100),
    consignment_note_number VARCHAR(100),
    delivery_number VARCHAR(100),
    eway_bill_number VARCHAR(100),
    vehicle_number VARCHAR(50),
    trailer_number VARCHAR(50),
    consignor_name VARCHAR(255),
    consignee_name VARCHAR(255),
    transporter_name VARCHAR(255),
    seal_detected BOOLEAN DEFAULT FALSE,
    signature_detected BOOLEAN DEFAULT FALSE,
    handwriting_detected BOOLEAN DEFAULT FALSE,
    handwritten_date VARCHAR(50),
    extraction_status VARCHAR(50),
    confidence_score NUMERIC(5,2),
    metadata_json JSONB,
    trip_no INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    token_cost NUMERIC(10, 6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: document_line_items
CREATE TABLE IF NOT EXISTS document_line_items (
    line_item_id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(document_id),
    line_number INTEGER,
    description TEXT,
    material_code VARCHAR(100),
    hsn_code VARCHAR(100),
    pieces_or_bundles VARCHAR(50),
    gross_weight_mt NUMERIC(12,3),
    net_weight_mt NUMERIC(12,3),
    quantity_mt NUMERIC(12,3),
    rate NUMERIC(14,2),
    taxable_value NUMERIC(14,2),
    tax_amount NUMERIC(14,2),
    total_value NUMERIC(14,2),
    batch_or_lot_number VARCHAR(100),
    quality_remarks TEXT
);

-- Table: document_visual_tags
CREATE TABLE IF NOT EXISTS document_visual_tags (
    visual_tag_id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(document_id),
    tag_type VARCHAR(100),
    detected BOOLEAN,
    extracted_value TEXT,
    location_description TEXT,
    confidence_score NUMERIC(5,2),
    review_required BOOLEAN DEFAULT FALSE
);

-- Table: document_audit_logs
CREATE TABLE IF NOT EXISTS document_audit_logs (
    audit_id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(document_id),
    action VARCHAR(100),
    old_value JSONB,
    new_value JSONB,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: document_embeddings
CREATE TABLE IF NOT EXISTS document_embeddings (
    document_id UUID PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
    embedding TEXT,
    text_content TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for Search
CREATE INDEX IF NOT EXISTS idx_documents_invoice_number ON documents(invoice_number);
CREATE INDEX IF NOT EXISTS idx_documents_lr_number ON documents(lr_number);
CREATE INDEX IF NOT EXISTS idx_documents_vehicle_number ON documents(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_documents_document_date ON documents(document_date);
CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_primary_reference ON documents(primary_reference_number);
CREATE INDEX IF NOT EXISTS idx_documents_consignor ON documents(consignor_name);
CREATE INDEX IF NOT EXISTS idx_documents_consignee ON documents(consignee_name);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_json ON documents USING GIN(metadata_json);

-- Table: trip_uploads
CREATE TABLE IF NOT EXISTS trip_uploads (
    upload_id UUID PRIMARY KEY,
    file_name VARCHAR(255),
    record_count INTEGER,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: trips
CREATE TABLE IF NOT EXISTS trips (
    trip_id UUID PRIMARY KEY,
    upload_id UUID REFERENCES trip_uploads(upload_id) ON DELETE CASCADE,
    trip_no INTEGER,
    trip_creation_date VARCHAR(100),
    trip_vehicle VARCHAR(100),
    destination VARCHAR(255),
    inv_no VARCHAR(100),
    lr_no VARCHAR(100),
    delivery_no_1 VARCHAR(100),
    delivery_no_2 VARCHAR(100),
    do_number VARCHAR(100),
    delivery_date VARCHAR(100),
    inv_date VARCHAR(100),
    inv_qty NUMERIC(12,3),
    primary_reference_number VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trips_trip_no ON trips(trip_no);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(trip_vehicle);
CREATE INDEX IF NOT EXISTS idx_trips_upload_id ON trips(upload_id);


-- Full-Text Search configuration (PostgreSQL specific, skipped in SQLite fallback)
-- To be run dynamically in PostgreSQL setup:
-- ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector;
-- CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);


-- Table: users
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: user_sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
