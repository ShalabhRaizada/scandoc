import Database from 'better-sqlite3';
import path from 'path';

function run() {
  const dbPath = path.resolve(__dirname, '../../scandoc.db');
  const db = new Database(dbPath);
  try {
    const batches = db.prepare(`
      SELECT batch_id, batch_name, status, total_documents, successful_documents, failed_documents, uploaded_at 
      FROM document_batches
      ORDER BY uploaded_at DESC
      LIMIT 5
    `).all();

    console.log('--- RECENT BATCHES ---');
    batches.forEach((b: any) => {
      console.log(`Batch ID: ${b.batch_id} | Name: ${b.batch_name} | Status: ${b.status} | Total: ${b.total_documents} | Success: ${b.successful_documents} | Failed: ${b.failed_documents} | Uploaded: ${b.uploaded_at}`);
      
      const docs = db.prepare(`
        SELECT document_id, original_file_name, stored_file_name, extraction_status, confidence_score 
        FROM documents 
        WHERE batch_id = ?
      `).all(b.batch_id);
      
      docs.forEach((d: any, i) => {
        console.log(`  [Doc ${i+1}] ID: ${d.document_id} | Orig: ${d.original_file_name} | Stored: ${d.stored_file_name} | Status: ${d.extraction_status} | Conf: ${d.confidence_score}`);
      });
      console.log('');
    });
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

run();
