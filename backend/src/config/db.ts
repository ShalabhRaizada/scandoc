import { Pool } from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let pgPool: Pool | null = null;
let sqliteDb: any = null;
let isPostgres = false;

export async function initDatabase(): Promise<void> {
  const usePg = process.env.DB_HOST && process.env.DB_USER && process.env.DB_DATABASE;

  if (usePg) {
    try {
      console.log('Attempting to connect to PostgreSQL...');
      pgPool = new Pool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        connectionTimeoutMillis: 5000,
      });

      // Test connection
      await pgPool.query('SELECT NOW()');
      isPostgres = true;
      console.log('Successfully connected to PostgreSQL database!');

      // Run PostgreSQL schema creation
      await runPgSchema();
      return;
    } catch (err: any) {
      console.warn('PostgreSQL connection failed. Error:', err.message);
      console.warn('Falling back to SQLite database...');
      pgPool = null;
    }
  } else {
    console.log('PostgreSQL environment variables not fully set. Using SQLite database...');
  }

  // Set up SQLite
  const dbPath = path.resolve(process.cwd(), 'scandoc.db');
  console.log(`Initializing SQLite database at: ${dbPath}`);
  sqliteDb = new Database(dbPath);
  isPostgres = false;

  // Run SQLite schema creation
  runSqliteSchema();
}

async function runPgSchema() {
  if (!pgPool) return;
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pgPool.query(schemaSql);

  // Check if search_vector column and trigger are already set up
  try {
    await pgPool.query('SELECT search_vector FROM documents LIMIT 1');
  } catch (err) {
    console.log('Adding tsvector search_vector and indices to PostgreSQL...');
    await pgPool.query(`
      ALTER TABLE documents ADD COLUMN search_vector tsvector;
      
      CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);
    `);
  }
}

function runSqliteSchema() {
  if (!sqliteDb) return;
  
  // Create tables using SQLite compatible SQL
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS document_batches (
        batch_id TEXT PRIMARY KEY,
        batch_name TEXT,
        uploaded_by TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        total_documents INTEGER,
        successful_documents INTEGER DEFAULT 0,
        failed_documents INTEGER DEFAULT 0,
        status TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
        document_id TEXT PRIMARY KEY,
        batch_id TEXT REFERENCES document_batches(batch_id),
        original_file_name TEXT,
        stored_file_name TEXT,
        file_path TEXT,
        file_type TEXT,
        file_size_bytes INTEGER,
        document_type TEXT,
        document_subtype TEXT,
        primary_reference_number TEXT,
        document_date TEXT,
        invoice_number TEXT,
        lr_number TEXT,
        consignment_note_number TEXT,
        delivery_number TEXT,
        eway_bill_number TEXT,
        vehicle_number TEXT,
        trailer_number TEXT,
        consignor_name TEXT,
        consignee_name TEXT,
        transporter_name TEXT,
        seal_detected INTEGER DEFAULT 0,
        signature_detected INTEGER DEFAULT 0,
        handwriting_detected INTEGER DEFAULT 0,
        handwritten_date TEXT,
        extraction_status TEXT,
        confidence_score REAL,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_line_items (
        line_item_id TEXT PRIMARY KEY,
        document_id TEXT REFERENCES documents(document_id),
        line_number INTEGER,
        description TEXT,
        material_code TEXT,
        hsn_code TEXT,
        pieces_or_bundles TEXT,
        gross_weight_mt REAL,
        net_weight_mt REAL,
        quantity_mt REAL,
        rate REAL,
        taxable_value REAL,
        tax_amount REAL,
        total_value REAL,
        batch_or_lot_number TEXT,
        quality_remarks TEXT
    );

    CREATE TABLE IF NOT EXISTS document_visual_tags (
        visual_tag_id TEXT PRIMARY KEY,
        document_id TEXT REFERENCES documents(document_id),
        tag_type TEXT,
        detected INTEGER,
        extracted_value TEXT,
        location_description TEXT,
        confidence_score REAL,
        review_required INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS document_audit_logs (
        audit_id TEXT PRIMARY KEY,
        document_id TEXT REFERENCES documents(document_id),
        action TEXT,
        old_value TEXT,
        new_value TEXT,
        changed_by TEXT,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_embeddings (
        document_id TEXT PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
        embedding TEXT,
        text_content TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_invoice_number ON documents(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_documents_lr_number ON documents(lr_number);
    CREATE INDEX IF NOT EXISTS idx_documents_vehicle_number ON documents(vehicle_number);
  `);
}

/**
 * Execute a query and return all rows
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (isPostgres && pgPool) {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    // Translate Postgres $1, $2 params to SQLite ? params
    // And handle duplicate or out-of-order parameters
    const matches = sql.match(/\$([0-9]+)/g);
    let sqliteParams: any[] = [];
    if (matches) {
      sqliteParams = matches.map(match => {
        const index = parseInt(match.substring(1), 10) - 1;
        return params[index];
      });
    } else {
      sqliteParams = params;
    }

    // Convert date types to string or serialize object parameters (like JSON)
    const processedParams = sqliteParams.map(p => {
      if (p !== null && typeof p === 'object') {
        return JSON.stringify(p);
      }
      if (typeof p === 'boolean') {
        return p ? 1 : 0;
      }
      return p;
    });

    const sqliteSql = sql.replace(/\$([0-9]+)/g, '?').replace(/\bILIKE\b/gi, 'LIKE');
    const stmt = sqliteDb.prepare(sqliteSql);

    if (sqliteSql.trim().toUpperCase().startsWith('SELECT')) {
      const rows = stmt.all(...processedParams);
      // Post-process rows: Parse JSON columns if any are JSON strings
      return rows.map((row: any) => {
        const processedRow = { ...row };
        // Parse metadata_json, old_value, new_value if they are strings
        if (typeof processedRow.metadata_json === 'string') {
          try { processedRow.metadata_json = JSON.parse(processedRow.metadata_json); } catch (e) {}
        }
        if (typeof processedRow.old_value === 'string') {
          try { processedRow.old_value = JSON.parse(processedRow.old_value); } catch (e) {}
        }
        if (typeof processedRow.new_value === 'string') {
          try { processedRow.new_value = JSON.parse(processedRow.new_value); } catch (e) {}
        }
        // Map boolean fields 0/1 back to true/false
        if (processedRow.seal_detected !== undefined) {
          processedRow.seal_detected = !!processedRow.seal_detected;
        }
        if (processedRow.signature_detected !== undefined) {
          processedRow.signature_detected = !!processedRow.signature_detected;
        }
        if (processedRow.handwriting_detected !== undefined) {
          processedRow.handwriting_detected = !!processedRow.handwriting_detected;
        }
        if (processedRow.detected !== undefined) {
          processedRow.detected = !!processedRow.detected;
        }
        if (processedRow.review_required !== undefined) {
          processedRow.review_required = !!processedRow.review_required;
        }
        return processedRow;
      }) as T[];
    } else {
      const result = stmt.run(...processedParams);
      return [] as T[];
    }
  }
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute a command (Insert/Update/Delete)
 */
export async function execute(sql: string, params: any[] = []): Promise<void> {
  await query(sql, params);
}

/**
 * Check if the database is running on PostgreSQL
 */
export function getIsPostgres(): boolean {
  return isPostgres;
}
