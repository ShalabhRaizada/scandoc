import { Pool } from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

let pgPool: Pool | null = null;
let sqliteDb: any = null;
let isPostgres = false;
let pgInitError: string | null = null;

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
      pgInitError = err.message || String(err);
      console.warn('PostgreSQL connection failed. Error:', err.message);
      console.warn('Falling back to SQLite database...');
      pgPool = null;
    }
  } else {
    console.log('PostgreSQL environment variables not fully set. Using SQLite database...');
  }

  // Set up SQLite
  const dbPath = path.resolve(__dirname, '../../scandoc.db');
  console.log(`Initializing SQLite database at: ${dbPath}`);
  sqliteDb = new Database(dbPath);
  isPostgres = false;

  // Run SQLite schema creation
  runSqliteSchema();

  // Dynamically add columns to existing tables if database already exists
  try {
    sqliteDb.exec("ALTER TABLE documents ADD COLUMN trip_no INTEGER;");
    console.log("Added trip_no column to documents table.");
  } catch (e) {
    // Column already exists
  }
  try {
    sqliteDb.exec("ALTER TABLE trips ADD COLUMN primary_reference_number TEXT;");
    console.log("Added primary_reference_number column to trips table.");
  } catch (e) {
    // Column already exists
  }
  try {
    sqliteDb.exec("ALTER TABLE documents ADD COLUMN prompt_tokens INTEGER;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE documents ADD COLUMN completion_tokens INTEGER;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE documents ADD COLUMN total_tokens INTEGER;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE documents ADD COLUMN token_cost REAL;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE document_embeddings ADD COLUMN stored_file_name TEXT;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE document_embeddings ADD COLUMN metadata_json TEXT;");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE document_batches ADD COLUMN customer_name TEXT;");
    console.log("Added customer_name column to document_batches table.");
  } catch (e) {}
  try {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login TEXT;");
    console.log("Added last_login column to users table.");
  } catch (e) {}

  await seedDefaultUsers();
}

async function runPgSchema() {
  if (!pgPool) return;
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pgPool.query(schemaSql);

  // Dynamically add columns if database already exists
  try {
    await pgPool.query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
      ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
      ADD COLUMN IF NOT EXISTS total_tokens INTEGER,
      ADD COLUMN IF NOT EXISTS token_cost NUMERIC(10, 6);
    `);
  } catch (err) {
    console.error('Error adding token tracking columns to PostgreSQL:', err);
  }

  try {
    await pgPool.query(`
      ALTER TABLE document_embeddings 
      ADD COLUMN IF NOT EXISTS stored_file_name TEXT,
      ADD COLUMN IF NOT EXISTS metadata_json JSONB;
    `);
  } catch (err) {
    console.error('Error adding metadata columns to PostgreSQL document_embeddings:', err);
  }

  try {
    await pgPool.query(`
      ALTER TABLE document_batches 
      ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
    `);
    console.log("Added customer_name column to PostgreSQL document_batches.");
  } catch (err) {
    console.error('Error adding customer_name column to PostgreSQL document_batches:', err);
  }

  try {
    await pgPool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
    `);
    console.log("Added last_login column to PostgreSQL users.");
  } catch (err) {
    console.error('Error adding last_login column to PostgreSQL users:', err);
  }

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
        status TEXT,
        customer_name TEXT
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
        trip_no INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        token_cost REAL,
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
        stored_file_name TEXT,
        metadata_json TEXT,
        embedding TEXT,
        text_content TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trip_uploads (
        upload_id TEXT PRIMARY KEY,
        file_name TEXT,
        record_count INTEGER,
        uploaded_by TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trips (
        trip_id TEXT PRIMARY KEY,
        upload_id TEXT REFERENCES trip_uploads(upload_id) ON DELETE CASCADE,
        trip_no INTEGER,
        trip_creation_date TEXT,
        trip_vehicle TEXT,
        destination TEXT,
        inv_no TEXT,
        lr_no TEXT,
        delivery_no_1 TEXT,
        delivery_no_2 TEXT,
        do_number TEXT,
        delivery_date TEXT,
        inv_date TEXT,
        inv_qty REAL,
        primary_reference_number TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        last_login TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_invoice_number ON documents(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_documents_lr_number ON documents(lr_number);
    CREATE INDEX IF NOT EXISTS idx_documents_vehicle_number ON documents(vehicle_number);
    CREATE INDEX IF NOT EXISTS idx_trips_trip_no ON trips(trip_no);
    CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(trip_vehicle);
    CREATE INDEX IF NOT EXISTS idx_trips_upload_id ON trips(upload_id);
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

export function getPgInitError(): string | null {
  return pgInitError;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

async function seedDefaultUsers() {
  try {
    const existing = await query('SELECT count(*) as count FROM users');
    if (existing && existing[0] && (existing[0].count === 0 || existing[0].count === '0')) {
      console.log('Seeding default users into database...');
      const defaultUsers = [
        { username: 'admin', password: 'password123', role: 'Admin' },
        { username: 'ops', password: 'password123', role: 'Ops User' },
        { username: 'viewer', password: 'password123', role: 'Viewer' },
        { username: 'auditor', password: 'password123', role: 'Auditor' }
      ];
      for (const u of defaultUsers) {
        const userId = uuidv4();
        const hash = hashPassword(u.password);
        await execute(
          'INSERT INTO users (user_id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
          [userId, u.username, hash, u.role]
        );
      }
      console.log('Successfully seeded default users.');
    }
    await backfillTokenMetrics();
    await runSelfHealingMigrations();
  } catch (err) {
    console.error('Error seeding default users:', err);
  }
}

async function backfillTokenMetrics() {
  try {
    const unpopulated = await query("SELECT count(*) as count FROM documents WHERE prompt_tokens IS NULL");
    if (unpopulated && unpopulated[0] && (unpopulated[0].count > 0 || unpopulated[0].count > '0')) {
      console.log('Back-filling existing documents with simulated token metrics...');
      const docs = await query("SELECT document_id FROM documents WHERE prompt_tokens IS NULL");
      for (const d of docs) {
        const simulatedPrompt = Math.floor(Math.random() * (1500 - 1200 + 1)) + 1200; // 1200 - 1500
        const simulatedCompletion = Math.floor(Math.random() * (500 - 300 + 1)) + 300; // 300 - 500
        const total = simulatedPrompt + simulatedCompletion;
        const cost = (simulatedPrompt * 0.075 + simulatedCompletion * 0.30) / 1000000;
        await execute(
          `UPDATE documents 
           SET prompt_tokens = $1, completion_tokens = $2, total_tokens = $3, token_cost = $4 
           WHERE document_id = $5`,
          [simulatedPrompt, simulatedCompletion, total, cost, d.document_id]
        );
      }
      console.log('Successfully back-filled token metrics.');
    }
  } catch (err) {
    console.error('Error back-filling token metrics:', err);
  }
}

async function runSelfHealingMigrations() {
  try {
    console.log('Running self-healing database migrations...');
    // 1. Repair token counts and costs
    await execute(`
      UPDATE documents 
      SET total_tokens = COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0) 
      WHERE total_tokens IS NULL OR total_tokens <> (COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))
    `);
    
    await execute(`
      UPDATE documents 
      SET token_cost = (COALESCE(prompt_tokens, 0) * 0.075 + COALESCE(completion_tokens, 0) * 0.30) / 1000000.0
      WHERE token_cost IS NULL OR token_cost = 0
    `);

    // 2. Normalize trip destinations casing to Title Case
    const allTrips = await query("SELECT trip_id, destination FROM trips WHERE destination IS NOT NULL AND destination <> ''");
    const toTitleCase = (str: string) => {
      return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };
    
    console.log(`Checking casing for ${allTrips.length} trip records...`);
    let updatedCount = 0;
    
    // For SQLite, update in batch using transactions if possible
    if (!isPostgres && sqliteDb) {
      const updateStmt = sqliteDb.prepare("UPDATE trips SET destination = ? WHERE trip_id = ?");
      const transaction = sqliteDb.transaction((rows: any[]) => {
        for (const row of rows) {
          const tc = toTitleCase(row.destination);
          if (tc !== row.destination) {
            updateStmt.run(tc, row.trip_id);
            updatedCount++;
          }
        }
      });
      transaction(allTrips);
    } else {
      // Postgres
      for (const row of allTrips) {
        const tc = toTitleCase(row.destination);
        if (tc !== row.destination) {
          await execute("UPDATE trips SET destination = $1 WHERE trip_id = $2", [tc, row.trip_id]);
          updatedCount++;
        }
      }
    }
    
    if (updatedCount > 0) {
      console.log(`Normalized casing of ${updatedCount} trip destinations to Title Case.`);
    }
    console.log('Self-healing database migrations completed successfully.');
  } catch (err: any) {
    console.error('Error running self-healing migrations:', err.message);
  }
}
