import Database from 'better-sqlite3';
import path from 'path';

function run() {
  const dbPath = path.resolve(__dirname, '../../scandoc.db');
  const db = new Database(dbPath);
  try {
    const rows = db.prepare(`
      SELECT document_id, original_file_name, prompt_tokens, completion_tokens, total_tokens, token_cost 
      FROM documents
    `).all();

    console.log('--- TOKENS IN DB ---');
    let sumPrompt = 0, sumCompletion = 0, sumTotal = 0, sumCost = 0;
    rows.forEach((row: any, i) => {
      console.log(`[Doc ${i+1}] ID: ${row.document_id.slice(0, 8)} | Prompt: ${row.prompt_tokens} | Completion: ${row.completion_tokens} | Total: ${row.total_tokens} | Cost: ${row.token_cost}`);
      sumPrompt += row.prompt_tokens || 0;
      sumCompletion += row.completion_tokens || 0;
      sumTotal += row.total_tokens || 0;
      sumCost += row.token_cost || 0;
    });

    console.log('\n--- AGGREGATES ---');
    console.log(`Sum Prompt: ${sumPrompt}`);
    console.log(`Sum Completion: ${sumCompletion}`);
    console.log(`Sum Total: ${sumTotal}`);
    console.log(`Sum Cost: ${sumCost}`);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

run();
