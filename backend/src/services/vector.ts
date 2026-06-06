import https from 'https';
import { query, execute } from '../config/db';

/**
 * Generate a 768-dimensional text embedding vector using Google Gemini's text-embedding-004 model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes('your_gemini_api_key_here')) {
    console.log('Gemini API key not configured. Generating deterministic mock vector...');
    return getMockVector(text);
  }

  const cleanText = text.trim().substring(0, 8000); // safety cap
  const requestBody = JSON.stringify({
    model: 'models/text-embedding-004',
    content: {
      parts: [{ text: cleanText }]
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) {
              console.warn('Gemini embedding API error:', parsed.error.message);
              // Fall back to mock vector instead of crashing
              resolve(getMockVector(text));
              return;
            }
            const values = parsed.embedding?.values;
            if (values && Array.isArray(values)) {
              resolve(values);
            } else {
              console.warn('Unexpected Gemini embedding API response structure. Using mock vector.');
              resolve(getMockVector(text));
            }
          } catch (err) {
            console.error('Failed to parse Gemini embedding response. Using mock vector.');
            resolve(getMockVector(text));
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('Gemini embedding request network error. Using mock vector:', err.message);
      resolve(getMockVector(text));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Generate a deterministic normalized float vector based on string hash for offline/mock support
 */
function getMockVector(text: string): number[] {
  const textLower = text.toLowerCase();
  const vector = [];
  
  // Calculate simple string hash
  let hash = 0;
  for (let i = 0; i < textLower.length; i++) {
    hash = (hash << 5) - hash + textLower.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  for (let i = 0; i < 768; i++) {
    // Math.sin(hash + i) generates a pseudo-random value between -1 and 1
    const val = Math.sin(hash + i * 97) * 10000;
    vector.push(val - Math.floor(val) - 0.5);
  }

  // Normalize the vector so that dot product equals cosine similarity
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => (magnitude > 0 ? v / magnitude : 0));
}

/**
 * Builds a comprehensive text document representation from document metadata
 */
export function buildDocumentTextRepresentation(doc: any): string {
  const parts: string[] = [];

  if (doc.document_type) parts.push(`Document Type: ${doc.document_type}`);
  if (doc.document_subtype) parts.push(`Subtype: ${doc.document_subtype}`);
  if (doc.primary_reference_number) parts.push(`Reference Number: ${doc.primary_reference_number}`);
  if (doc.document_date) parts.push(`Date: ${doc.document_date}`);
  if (doc.vehicle_number) parts.push(`Vehicle: ${doc.vehicle_number}`);

  // Parties
  if (doc.parties) {
    const p = doc.parties;
    if (p.consignor?.name) parts.push(`Consignor: ${p.consignor.name}`);
    if (p.consignee?.name) parts.push(`Consignee: ${p.consignee.name}`);
    if (p.transporter?.name) parts.push(`Transporter: ${p.transporter.name}`);
  } else {
    if (doc.consignor_name) parts.push(`Consignor: ${doc.consignor_name}`);
    if (doc.consignee_name) parts.push(`Consignee: ${doc.consignee_name}`);
    if (doc.transporter_name) parts.push(`Transporter: ${doc.transporter_name}`);
  }

  // Logistics Numbers
  if (doc.logistics) {
    const l = doc.logistics;
    if (l.invoice_number) parts.push(`Invoice Number: ${l.invoice_number}`);
    if (l.eway_bill_number) parts.push(`E-way Bill: ${l.eway_bill_number}`);
    if (l.delivery_number) parts.push(`Delivery Number: ${l.delivery_number}`);
  }

  // Line items
  if (doc.line_items && Array.isArray(doc.line_items)) {
    doc.line_items.forEach((item: any) => {
      parts.push(`Line Item: ${item.description || ''} ${item.material_code || ''} Net weight ${item.net_weight_mt || 0} MT`);
    });
  }

  // Visual Tags text
  if (doc.visual_tags) {
    const vt = doc.visual_tags;
    if (vt.seal_detected && vt.seal_text) parts.push(`Seal Text: ${vt.seal_text}`);
    if (vt.comments && Array.isArray(vt.comments)) {
      vt.comments.forEach((c: any) => {
        if (c.comment_text) parts.push(`Comment: ${c.comment_text}`);
      });
    }
  }

  return parts.join(' | ');
}

/**
 * Upsert document vector embedding in the database
 */
export async function upsertDocumentEmbedding(documentId: string, metadataJson: any): Promise<void> {
  try {
    const textContent = buildDocumentTextRepresentation(metadataJson);
    console.log(`Generating embedding for document ${documentId}. Text length: ${textContent.length}`);
    
    const vector = await generateEmbedding(textContent);

    // Dialect agnostic upsert: Delete if exists, then insert
    await execute('DELETE FROM document_embeddings WHERE document_id = $1', [documentId]);
    await execute(
      `INSERT INTO document_embeddings (document_id, embedding, text_content, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [documentId, JSON.stringify(vector), textContent]
    );

    console.log(`Upserted vector embedding for document ${documentId}`);
  } catch (err: any) {
    console.error(`Error upserting embedding for document ${documentId}:`, err.message);
  }
}

/**
 * Compute Cosine Similarity between two vectors
 */
export function computeCosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) return 0;
  
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;

  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
    mA += v1[i] * v1[i];
    mB += v2[i] * v2[i];
  }

  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

export interface SemanticSearchResult {
  document_id: string;
  similarity: number;
}

/**
 * Perform a semantic vector search across all documents
 */
export async function semanticSearch(
  queryText: string,
  limit = 20
): Promise<SemanticSearchResult[]> {
  // 1. Generate query embedding
  const queryVector = await generateEmbedding(queryText);

  // 2. Fetch all document embeddings from DB
  const rows = await query('SELECT document_id, embedding FROM document_embeddings');
  
  const results: SemanticSearchResult[] = [];

  for (const row of rows) {
    try {
      const docEmbedding = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
      if (Array.isArray(docEmbedding) && docEmbedding.length === queryVector.length) {
        const sim = computeCosineSimilarity(queryVector, docEmbedding);
        results.push({
          document_id: row.document_id,
          similarity: sim,
        });
      }
    } catch (e) {
      // ignore parse errors for corrupt records
    }
  }

  // 3. Sort by similarity desc
  results.sort((a, b) => b.similarity - a.similarity);

  // 4. Return top results
  return results.slice(0, limit);
}
