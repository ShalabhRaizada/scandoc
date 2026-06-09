import { Pool } from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const usePg = process.env.DB_HOST && process.env.DB_USER && process.env.DB_DATABASE;
  let rows: any[] = [];

  if (usePg) {
    console.log('Querying PostgreSQL database...');
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    });
    try {
      const res = await pool.query(`
        SELECT document_id, original_file_name, stored_file_name, 
               extraction_status, confidence_score, created_at 
        FROM documents
        ORDER BY created_at DESC
        LIMIT 10
      `);
      rows = res.rows;
      await pool.end();
    } catch (e: any) {
      console.error('PostgreSQL query error:', e.message);
    }
  } else {
    console.log('Querying SQLite database...');
    const dbPath = path.resolve(__dirname, '../../scandoc.db');
    const db = new Database(dbPath);
    try {
      rows = db.prepare(`
        SELECT document_id, original_file_name, stored_file_name, 
               extraction_status, confidence_score, created_at 
        FROM documents
        ORDER BY created_at DESC
        LIMIT 10
      `).all();
    } catch (e: any) {
      console.error('SQLite query error:', e.message);
    }
  }

  console.log('\n========================================================================');
  console.log('LATEST DOCUMENTS IN DATABASE');
  console.log('========================================================================');
  if (rows.length === 0) {
    console.log('No documents found in the database.');
  } else {
    rows.forEach((row, idx) => {
      console.log(`\n#${idx + 1}:`);
      console.log(`  ID:            ${row.document_id}`);
      console.log(`  Original Name: ${row.original_file_name}`);
      console.log(`  Stored Name:   ${row.stored_file_name}`);
      console.log(`  Status:        ${row.extraction_status}`);
      console.log(`  Confidence:    ${row.confidence_score}`);
      console.log(`  Created At:    ${row.created_at}`);
    });
  }
  console.log('========================================================================\n');
}

run();
