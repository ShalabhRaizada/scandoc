import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import archiver = require('archiver');
import { query, queryOne, execute, getIsPostgres } from '../config/db';
import { extractDocumentMetadata, ExtractionResult } from '../services/ai';
import { 
  getFilePath, 
  renameDocumentLogically, 
  preprocessImageIfNeeded,
  isGcsEnabled,
  getSignedUrlForFile,
  getFileStream,
  fileExists
} from '../services/storage';
import { upsertDocumentEmbedding, semanticSearch } from '../services/vector';
import { requireRoles, authenticateToken } from '../middleware/auth';

const router = Router();

// Secure all API endpoints behind token authentication
router.use(authenticateToken);

// Configure Multer for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(process.cwd(), 'uploads'));
  },
  filename: (req, file, cb) => {
    // Keep a unique temporary filename
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `temp_${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format.'));
    }
  },
});

// Helper for audit logs
async function createAuditLog(
  documentId: string,
  action: string,
  oldValue: any,
  newValue: any,
  changedBy: string
) {
  const auditId = uuidv4();
  await execute(
    `INSERT INTO document_audit_logs (audit_id, document_id, action, old_value, new_value, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auditId, documentId, action, oldValue, newValue, changedBy]
  );
}

// Middleware: Role-Based Access Control validation imported from middleware/auth

/**
 * 10.1 Upload Batch API
 * POST /api/document-batches/upload
 */
router.post(
  '/document-batches/upload',
  requireRoles(['Admin', 'Ops User']),
  (req: Request, res: Response) => {
    // Use multer array upload (up to 10 files)
    const uploadMiddleware = upload.array('files[]', 10);
    
    uploadMiddleware(req, res, async (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      const files = req.files as Express.Multer.File[] || [];
      const batchName = req.body.batch_name || `Batch_${new Date().toISOString().slice(0, 10)}`;
      const customerName = req.body.customer_name || 'Generic Customer';
      const uploadedBy = req.body.uploaded_by || 'Unknown User';

      if (files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
      }

      if (files.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 files are allowed in one batch.' });
      }

      // Check for zero-byte files
      for (const file of files) {
        if (file.size === 0) {
          // Cleanup
          files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
          return res.status(400).json({ error: `Rejecting zero-byte file: ${file.originalname}` });
        }
      }

      // Check for duplicate filenames in the same upload batch
      const filenames = files.map(f => f.originalname);
      const uniqueFilenames = new Set(filenames);
      if (uniqueFilenames.size !== filenames.length) {
        // Cleanup
        files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
        return res.status(400).json({ error: 'Duplicate file detected in upload batch.' });
      }

      const batchId = uuidv4();

      try {
        // Create Batch Record
        await execute(
          `INSERT INTO document_batches (batch_id, batch_name, uploaded_by, total_documents, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [batchId, batchName, uploadedBy, files.length, 'Uploaded']
        );

        const responseDocs = [];

        // Create document records in Uploaded state
        for (const file of files) {
          const documentId = uuidv4();
          
          await execute(
            `INSERT INTO documents (
              document_id, batch_id, original_file_name, stored_file_name, file_path, 
              file_type, file_size_bytes, extraction_status, confidence_score
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              documentId,
              batchId,
              file.originalname,
              file.filename, // temp name initially
              file.path,
              path.extname(file.originalname).substring(1),
              file.size,
              'Uploaded',
              0.0
            ]
          );

          // Audit log for upload
          await createAuditLog(documentId, 'Upload', null, { original_file_name: file.originalname }, uploadedBy);

          responseDocs.push({
            document_id: documentId,
            original_file_name: file.originalname,
            status: 'Uploaded',
          });
        }

        res.json({
          batch_id: batchId,
          total_documents: files.length,
          status: 'Uploaded',
          documents: responseDocs,
        });
      } catch (dbErr: any) {
        console.error('Error inserting upload info to database:', dbErr);
        // Cleanup files
        files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
        res.status(500).json({ error: 'Database error creating batch and document records.' });
      }
    });
  }
);

/**
 * Helper to process a document extraction asynchronously
 */
async function processDocumentExtraction(documentId: string, batchId: string, uploadedBy: string) {
  let doc: any = null;
  try {
    // Get document details
    doc = await queryOne(
      'SELECT original_file_name, stored_file_name, file_path FROM documents WHERE document_id = $1',
      [documentId]
    );

    if (!doc) {
      console.error(`Document ${documentId} not found for async extraction`);
      return;
    }

    // Update status to Processing
    await execute(
      'UPDATE documents SET extraction_status = $1 WHERE document_id = $2',
      ['Processing', documentId]
    );

    // Auto-crop and enhance image documents before performing AI extraction
    await preprocessImageIfNeeded(doc.file_path);

    // Call AI Extraction Service
    const extractedData = await extractDocumentMetadata(doc.file_path, doc.original_file_name);

    // Check if the document type is recognized and key data could be extracted
    const hasAnyKeyData = !!(
      extractedData.logistics?.invoice_number ||
      extractedData.logistics?.gst_invoice_number ||
      extractedData.logistics?.lr_number ||
      extractedData.logistics?.delivery_number ||
      extractedData.logistics?.vehicle_number ||
      extractedData.primary_reference_number
    );

    const isRecognized = extractedData.document_type && 
                         extractedData.document_type !== 'Unknown Document Type' &&
                         !extractedData.document_type.toLowerCase().includes('unknown');

    if (!isRecognized || !hasAnyKeyData || (extractedData.confidence_score !== undefined && extractedData.confidence_score < 0.25)) {
      extractedData.extraction_status = 'Failed';
      if (!extractedData.review_flags) {
        extractedData.review_flags = [];
      }
      if (!isRecognized) {
        extractedData.review_flags.push('Unrecognized document: Document type could not be identified');
      }
      if (!hasAnyKeyData) {
        extractedData.review_flags.push('Unrecognized document: No key logistics identifiers extracted');
      }
      if (extractedData.confidence_score !== undefined && extractedData.confidence_score < 0.25) {
        extractedData.review_flags.push(`Unrecognized document: Confidence score is extremely low (${extractedData.confidence_score?.toFixed(2) || 0})`);
      }
    }

    // Write primary extracted fields directly to normal columns (14.1)
    await execute(
      `UPDATE documents 
       SET document_type = $1,
           document_subtype = $2,
           primary_reference_number = $3,
           document_date = $4,
           invoice_number = $5,
           lr_number = $6,
           consignment_note_number = $7,
           delivery_number = $8,
           eway_bill_number = $9,
           vehicle_number = $10,
           trailer_number = $11,
           consignor_name = $12,
           consignee_name = $13,
           transporter_name = $14,
           seal_detected = $15,
           signature_detected = $16,
           handwriting_detected = $17,
           handwritten_date = $18,
           extraction_status = $19,
           confidence_score = $20,
           metadata_json = $21,
           prompt_tokens = $22,
           completion_tokens = $23,
           total_tokens = $24,
           token_cost = $25,
           updated_at = CURRENT_TIMESTAMP
       WHERE document_id = $26`,
      [
        extractedData.document_type,
        extractedData.document_subtype,
        extractedData.primary_reference_number,
        extractedData.document_date || null,
        extractedData.logistics?.invoice_number || extractedData.logistics?.gst_invoice_number || null,
        extractedData.logistics?.lr_number || null,
        extractedData.logistics?.consignment_note_number || null,
        extractedData.logistics?.delivery_number || null,
        extractedData.logistics?.eway_bill_number || null,
        extractedData.logistics?.vehicle_number || null,
        extractedData.logistics?.trailer_number || null,
        extractedData.parties?.consignor?.name || null,
        extractedData.parties?.consignee?.name || null,
        extractedData.parties?.transporter?.name || null,
        extractedData.visual_tags?.seal_detected || false,
        extractedData.visual_tags?.signature_detected || false,
        extractedData.visual_tags?.handwriting_detected || false,
        extractedData.visual_tags?.handwritten_fields?.find(f => f.field_name === 'material_received_on')?.value || null,
        extractedData.extraction_status,
        extractedData.confidence_score,
        extractedData, // JSONB
        extractedData.prompt_tokens || 0,
        extractedData.completion_tokens || 0,
        extractedData.total_tokens || 0,
        extractedData.token_cost || 0.0,
        documentId
      ]
    );

    // Save Line Items
    if (extractedData.line_items && Array.isArray(extractedData.line_items)) {
      // First clean existing line items if any
      await execute('DELETE FROM document_line_items WHERE document_id = $1', [documentId]);

      for (const item of extractedData.line_items) {
        const lineItemId = uuidv4();
        await execute(
          `INSERT INTO document_line_items (
            line_item_id, document_id, line_number, description, material_code, hsn_code,
            pieces_or_bundles, gross_weight_mt, net_weight_mt, quantity_mt, rate,
            taxable_value, tax_amount, total_value, batch_or_lot_number, quality_remarks
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            lineItemId,
            documentId,
            item.line_number,
            item.description,
            item.material_code || null,
            item.hsn_code || null,
            item.pieces_or_bundles || null,
            item.gross_weight_mt || null,
            item.net_weight_mt || null,
            item.quantity_mt || null,
            item.rate || null,
            item.taxable_value || null,
            item.tax_amount || null,
            item.total_value || null,
            item.batch_or_lot_number || null,
            item.quality_remarks || null
          ]
        );
      }
    }

    // Save Visual Tags
    if (extractedData.visual_tags) {
      await execute('DELETE FROM document_visual_tags WHERE document_id = $1', [documentId]);
      const vt = extractedData.visual_tags;

      // Add Seal Tag
      if (vt.seal_detected !== undefined) {
        await execute(
          `INSERT INTO document_visual_tags (visual_tag_id, document_id, tag_type, detected, extracted_value, location_description, confidence_score, review_required)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uuidv4(), documentId, 'SEAL', vt.seal_detected, vt.seal_text, vt.seal_location, vt.seal_confidence, vt.seal_confidence < 0.75]
        );
      }

      // Add Signature Tag
      if (vt.signature_detected !== undefined) {
        await execute(
          `INSERT INTO document_visual_tags (visual_tag_id, document_id, tag_type, detected, extracted_value, location_description, confidence_score, review_required)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uuidv4(), documentId, 'SIGNATURE', vt.signature_detected, null, vt.signature_location, vt.signature_confidence, vt.signature_confidence < 0.75]
        );
      }

      // Add Handwritten fields
      if (vt.handwritten_fields && Array.isArray(vt.handwritten_fields)) {
        for (const field of vt.handwritten_fields) {
          let tagType = 'HANDWRITTEN_COMMENT';
          if (field.field_name.includes('date') || field.field_name.includes('received_on')) {
            tagType = 'HANDWRITTEN_DATE';
          } else if (field.field_name.includes('truck') || field.field_name.includes('vehicle')) {
            tagType = 'HANDWRITTEN_TRUCK_NUMBER';
          } else if (field.field_name.includes('qty') || field.field_name.includes('quantity')) {
            tagType = 'HANDWRITTEN_QUANTITY';
          }
          await execute(
            `INSERT INTO document_visual_tags (visual_tag_id, document_id, tag_type, detected, extracted_value, location_description, confidence_score, review_required)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [uuidv4(), documentId, tagType, true, field.value, field.location, field.confidence, field.confidence < 0.75 || field.review_required]
          );
        }
      }

      // Add Remarks
      if (vt.comments && Array.isArray(vt.comments)) {
        for (const comment of vt.comments) {
          await execute(
            `INSERT INTO document_visual_tags (visual_tag_id, document_id, tag_type, detected, extracted_value, location_description, confidence_score, review_required)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [uuidv4(), documentId, 'HANDWRITTEN_COMMENT', true, comment.comment_text, comment.location, comment.confidence, comment.confidence < 0.75 || comment.review_required]
          );
        }
      }
    }

    // Generate/upsert document embedding for semantic search
    await upsertDocumentEmbedding(documentId, extractedData);

    // Rename stored file logically based on extracted metadata (Rule 13)
    const finalStoredName = await renameDocumentLogically(
      documentId,
      doc.original_file_name,
      doc.stored_file_name,
      {
        invoice_number: extractedData.logistics?.invoice_number || extractedData.logistics?.gst_invoice_number,
        lr_number: extractedData.logistics?.lr_number,
        consignment_note_number: extractedData.logistics?.consignment_note_number,
        delivery_number: extractedData.logistics?.delivery_number,
        vehicle_number: extractedData.logistics?.vehicle_number,
        document_date: extractedData.document_date
      }
    );

    // Update search vector if PostgreSQL (PostgreSQL GIN)
    if (getIsPostgres()) {
      await execute(`
        UPDATE documents
        SET search_vector = to_tsvector(
          'english',
          coalesce(original_file_name, '') || ' ' ||
          coalesce(document_type, '') || ' ' ||
          coalesce(primary_reference_number, '') || ' ' ||
          coalesce(invoice_number, '') || ' ' ||
          coalesce(lr_number, '') || ' ' ||
          coalesce(vehicle_number, '') || ' ' ||
          coalesce(consignor_name, '') || ' ' ||
          coalesce(consignee_name, '') || ' ' ||
          coalesce(metadata_json::text, '')
        )
        WHERE document_id = $1
      `, [documentId]);
    }

    // Create Audit Log for extraction success
    await createAuditLog(
      documentId,
      'Extraction',
      null,
      { status: extractedData.extraction_status, confidence: extractedData.confidence_score },
      'AI Extraction Service'
    );

    // Update batch counter stats
    const isFailed = extractedData.extraction_status === 'Failed';
    const isSuccess = !isFailed;
    await execute(
      `UPDATE document_batches 
       SET successful_documents = successful_documents + $1,
           failed_documents = failed_documents + $2
       WHERE batch_id = $3`,
      [isSuccess ? 1 : 0, isFailed ? 1 : 0, batchId]
    );

    // Match document with trip record and link them
    await matchTripForDocument(documentId);

    // Run duplicate check and flag if necessary
    await runDuplicateCheckingAndFlagging(documentId);

  } catch (error: any) {
    console.error(`Error extracting metadata for document ${documentId}:`, error);

    // Clean up local temp file on failure
    try {
      if (doc && doc.stored_file_name) {
        const localPath = getFilePath(doc.stored_file_name);
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      }
    } catch (cleanupErr) {
      console.error('Error cleaning up local file after extraction failure:', cleanupErr);
    }

    // Update status to Failed
    await execute(
      `UPDATE documents 
       SET extraction_status = 'Failed', confidence_score = 0.0
       WHERE document_id = $1`,
      [documentId]
    );

    // Update batch stats
    await execute(
      `UPDATE document_batches 
       SET failed_documents = failed_documents + 1
       WHERE batch_id = $1`,
      [batchId]
    );

    await createAuditLog(documentId, 'Extraction Failed', null, { error: error.message }, 'AI Extraction Service');
  }
}

/**
 * 10.2 Start Extraction API
 * POST /api/document-batches/{batch_id}/extract
 */
router.post(
  '/document-batches/:batch_id/extract',
  requireRoles(['Admin', 'Ops User']),
  async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const uploadedBy = req.body.uploaded_by || 'Ops User';

    try {
      const batch = await queryOne(
        'SELECT batch_id, status FROM document_batches WHERE batch_id = $1',
        [batch_id]
      );

      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      // Update batch status to Processing
      await execute(
        "UPDATE document_batches SET status = 'Processing' WHERE batch_id = $1",
        [batch_id]
      );

      // Get all documents in this batch
      const docs = await query(
        'SELECT document_id FROM documents WHERE batch_id = $1',
        [batch_id]
      );

      // Fire off async extractions in background with a 4-second delay between requests
      (async () => {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          if (i > 0) {
            console.log(`Waiting 4 seconds before processing next document in batch to avoid rate limits...`);
            await new Promise((r) => setTimeout(r, 4000));
          }
          await processDocumentExtraction(doc.document_id, batch_id, uploadedBy);
        }

        // Check if all processed and update batch final status
        const updatedBatch = await queryOne(
          'SELECT total_documents, successful_documents, failed_documents FROM document_batches WHERE batch_id = $1',
          [batch_id]
        );

        if (updatedBatch) {
          const finalStatus =
            updatedBatch.failed_documents === updatedBatch.total_documents
              ? 'Failed'
              : 'Processed';
          await execute(
            'UPDATE document_batches SET status = $1 WHERE batch_id = $2',
            [finalStatus, batch_id]
          );
        }
      })();

      res.json({
        batch_id,
        status: 'Processing',
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Get All Batches API
 * GET /api/document-batches
 */
router.get('/document-batches', async (req: Request, res: Response) => {
  try {
    const batches = await query(
      `SELECT batch_id, batch_name, uploaded_by, uploaded_at, total_documents, status 
       FROM document_batches 
       ORDER BY uploaded_at DESC`
    );
    res.json(batches);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.3 Get Batch Status API
 * GET /api/document-batches/{batch_id}/status
 */
router.get('/document-batches/:batch_id/status', async (req: Request, res: Response) => {
  const { batch_id } = req.params;

  try {
    const batch = await queryOne(
      `SELECT batch_id, status, total_documents, successful_documents, failed_documents 
       FROM document_batches WHERE batch_id = $1`,
      [batch_id]
    );

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const pending = batch.total_documents - (batch.successful_documents + batch.failed_documents);

    res.json({
      batch_id: batch.batch_id,
      status: batch.status,
      total_documents: batch.total_documents,
      successful_documents: batch.successful_documents,
      failed_documents: batch.failed_documents,
      pending_documents: pending,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Batch Documents
 * GET /api/document-batches/{batch_id}/documents
 */
router.get('/document-batches/:batch_id/documents', async (req: Request, res: Response) => {
  const { batch_id } = req.params;

  try {
    const docs = await query(
      `SELECT document_id, original_file_name, stored_file_name, file_type, file_size_bytes,
              document_type, document_subtype, primary_reference_number, document_date,
              invoice_number, lr_number, consignment_note_number, vehicle_number,
              seal_detected, signature_detected, handwriting_detected,
              extraction_status, confidence_score, trip_no, created_at
       FROM documents 
       WHERE batch_id = $1 AND extraction_status NOT IN ('Manually Approved', 'Approved')
       ORDER BY created_at ASC`,
      [batch_id]
    );

    res.json(docs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.4 Get Document Metadata API
 * GET /api/documents/{document_id}/metadata
 */
router.get('/documents/:document_id/metadata', async (req: Request, res: Response) => {
  const { document_id } = req.params;

  try {
    // Get full document fields and visual tags
    const doc = await queryOne(
      'SELECT document_id, original_file_name, stored_file_name, file_type, file_size_bytes, extraction_status, confidence_score, metadata_json FROM documents WHERE document_id = $1',
      [document_id]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Log the search/view access in audit logs
    const user = req.header('X-User') || 'Viewer User';
    await createAuditLog(document_id, 'Search access', doc.metadata_json, null, user);

    res.json({
      document_id: doc.document_id,
      original_file_name: doc.original_file_name,
      stored_file_name: doc.stored_file_name,
      file_type: doc.file_type,
      file_size_bytes: doc.file_size_bytes,
      extraction_status: doc.extraction_status,
      confidence_score: doc.confidence_score,
      metadata_json: doc.metadata_json || {},
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.5 Update Document Metadata API
 * PUT /api/documents/{document_id}/metadata
 */
router.put(
  '/documents/:document_id/metadata',
  requireRoles(['Admin', 'Ops User']),
  async (req: Request, res: Response) => {
    const { document_id } = req.params;
    const { metadata_json } = req.body;
    const changedBy = req.header('X-User') || 'Ops User';

    if (!metadata_json) {
      return res.status(400).json({ error: 'No metadata JSON provided' });
    }

    try {
      const oldDoc = await queryOne(
        'SELECT stored_file_name, original_file_name, metadata_json, extraction_status FROM documents WHERE document_id = $1',
        [document_id]
      );

      if (!oldDoc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Merge and validate status based on rules
      let newStatus = metadata_json.extraction_status || 'Needs Review';
      const flags = [];

      // Validate on edit:
      const score = metadata_json.confidence_score !== undefined ? metadata_json.confidence_score : 1.0;
      if (score < 0.75) {
        flags.push('Low confidence score');
      }
      
      const docType = metadata_json.document_type;
      if (!docType || docType.trim() === '') {
        flags.push('Document type is missing');
      }

      const refNo = metadata_json.primary_reference_number;
      if (!refNo || refNo.trim() === '') {
        flags.push('Primary reference number is missing');
      }

      const vehicleNo = metadata_json.logistics?.vehicle_number;
      if (!vehicleNo || vehicleNo.trim() === '') {
        flags.push('Vehicle number is missing');
      }

      const isUserApproval = (newStatus === 'Approved' || newStatus === 'Manually Approved');

      if (isUserApproval) {
        newStatus = 'Manually Approved';
      } else {
        if (flags.length === 0) {
          if (newStatus === 'Needs Review') {
            newStatus = 'Manually Approved';
          }
        } else {
          newStatus = 'Needs Review';
        }
      }

      // Sync status into the metadata_json before saving/database write
      metadata_json.extraction_status = newStatus;

      // Update relational database columns and metadata_json (14.1 + 14.2)
      await execute(
        `UPDATE documents 
         SET document_type = $1,
             document_subtype = $2,
             primary_reference_number = $3,
             document_date = $4,
             invoice_number = $5,
             lr_number = $6,
             consignment_note_number = $7,
             delivery_number = $8,
             eway_bill_number = $9,
             vehicle_number = $10,
             trailer_number = $11,
             consignor_name = $12,
             consignee_name = $13,
             transporter_name = $14,
             seal_detected = $15,
             signature_detected = $16,
             handwriting_detected = $17,
             handwritten_date = $18,
             extraction_status = $19,
             confidence_score = $20,
             metadata_json = $21,
             updated_at = CURRENT_TIMESTAMP
         WHERE document_id = $22`,
        [
          metadata_json.document_type || null,
          metadata_json.document_subtype || null,
          metadata_json.primary_reference_number || null,
          metadata_json.document_date || null,
          metadata_json.logistics?.invoice_number || metadata_json.logistics?.gst_invoice_number || null,
          metadata_json.logistics?.lr_number || null,
          metadata_json.logistics?.consignment_note_number || null,
          metadata_json.logistics?.delivery_number || null,
          metadata_json.logistics?.eway_bill_number || null,
          metadata_json.logistics?.vehicle_number || null,
          metadata_json.logistics?.trailer_number || null,
          metadata_json.parties?.consignor?.name || null,
          metadata_json.parties?.consignee?.name || null,
          metadata_json.parties?.transporter?.name || null,
          metadata_json.visual_tags?.seal_detected || false,
          metadata_json.visual_tags?.signature_detected || false,
          metadata_json.visual_tags?.handwriting_detected || false,
          metadata_json.visual_tags?.handwritten_fields?.find((f: any) => f.field_name === 'material_received_on')?.value || null,
          newStatus,
          score,
          metadata_json, // JSONB
          document_id
        ]
      );

      // Save line items
      if (metadata_json.line_items && Array.isArray(metadata_json.line_items)) {
        await execute('DELETE FROM document_line_items WHERE document_id = $1', [document_id]);
        for (const item of metadata_json.line_items) {
          const lineItemId = uuidv4();
          await execute(
            `INSERT INTO document_line_items (
              line_item_id, document_id, line_number, description, material_code, hsn_code,
              pieces_or_bundles, gross_weight_mt, net_weight_mt, quantity_mt, rate,
              taxable_value, tax_amount, total_value, batch_or_lot_number, quality_remarks
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              lineItemId,
              document_id,
              item.line_number,
              item.description,
              item.material_code || null,
              item.hsn_code || null,
              item.pieces_or_bundles || null,
              item.gross_weight_mt || null,
              item.net_weight_mt || null,
              item.quantity_mt || null,
              item.rate || null,
              item.taxable_value || null,
              item.tax_amount || null,
              item.total_value || null,
              item.batch_or_lot_number || null,
              item.quality_remarks || null
            ]
          );
        }
      }

      // Update document embedding
      await upsertDocumentEmbedding(document_id, metadata_json);

      // Rename file if primary references changed (Logical naming)
      await renameDocumentLogically(
        document_id,
        oldDoc.original_file_name,
        oldDoc.stored_file_name,
        {
          invoice_number: metadata_json.logistics?.invoice_number || metadata_json.logistics?.gst_invoice_number,
          lr_number: metadata_json.logistics?.lr_number,
          consignment_note_number: metadata_json.logistics?.consignment_note_number,
          delivery_number: metadata_json.logistics?.delivery_number,
          vehicle_number: metadata_json.logistics?.vehicle_number,
          document_date: metadata_json.document_date
        }
      );

      // Match edited document with trip record and link/rename
      await matchTripForDocument(document_id);

      // Run duplicate check and flag if necessary
      await runDuplicateCheckingAndFlagging(document_id);

      // Detect if transitioning to Manually Approved
      const wasApproved = oldDoc.extraction_status === 'Manually Approved' || oldDoc.extraction_status === 'Approved';
      const isApproved = newStatus === 'Manually Approved';
      const auditAction = (isApproved && !wasApproved) ? 'Manual Approval' : 'Metadata edit';

      // Log metadata edit in audit logs
      await createAuditLog(
        document_id,
        auditAction,
        oldDoc.metadata_json,
        metadata_json,
        changedBy
      );

      res.json({
        document_id,
        status: 'Updated',
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * API for Semantic Vector Search
 * GET /api/documents/semantic-search
 */
router.get('/documents/semantic-search', async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query string missing' });
  }

  try {
    const matches = await semanticSearch(q.toString(), 20);
    if (matches.length === 0) {
      return res.json({ documents: [] });
    }

    // Fetch document fields for matched IDs
    const ids = matches.map(m => m.document_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    
    const docs = await query(`
      SELECT document_id, document_type, primary_reference_number, vehicle_number, 
             document_date, original_file_name, stored_file_name, extraction_status, confidence_score
      FROM documents 
      WHERE document_id IN (${placeholders})
    `, ids);

    // Map similarity scores
    const results = docs.map(d => {
      const match = matches.find(m => m.document_id === d.document_id);
      return {
        ...d,
        similarity: match ? match.similarity : 0
      };
    }).sort((a, b) => b.similarity - a.similarity);

    res.json({ documents: results });
  } catch (err: any) {
    console.error('Semantic search API error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.6 Search Documents API
 * GET /api/documents/search
 */
router.get('/documents/search', async (req: Request, res: Response) => {
  const {
    document_type,
    invoice_number,
    lr_number,
    vehicle_number,
    consignor_name,
    consignee_name,
    date_from,
    date_to,
    seal_detected,
    signature_detected,
    handwriting_detected,
    trip_nos,
    q, // Free text query
  } = req.query;

  try {
    let sql = `
      SELECT document_id, document_type, primary_reference_number, 
             invoice_number, lr_number, vehicle_number, document_date, 
             consignor_name, consignee_name, seal_detected, signature_detected, 
             handwriting_detected, confidence_score, original_file_name, stored_file_name, extraction_status, trip_no
      FROM documents
      WHERE 1=1
    `;
    const params: any[] = [];
    let pCount = 1;

    // Filters
    if (document_type) {
      sql += ` AND document_type ILIKE $${pCount}`;
      params.push(`%${document_type}%`);
      pCount++;
    }
    if (invoice_number) {
      sql += ` AND invoice_number ILIKE $${pCount}`;
      params.push(`%${invoice_number}%`);
      pCount++;
    }
    if (lr_number) {
      sql += ` AND lr_number ILIKE $${pCount}`;
      params.push(`%${lr_number}%`);
      pCount++;
    }
    if (vehicle_number) {
      sql += ` AND vehicle_number ILIKE $${pCount}`;
      params.push(`%${vehicle_number}%`);
      pCount++;
    }
    if (consignor_name) {
      sql += ` AND consignor_name ILIKE $${pCount}`;
      params.push(`%${consignor_name}%`);
      pCount++;
    }
    if (consignee_name) {
      sql += ` AND consignee_name ILIKE $${pCount}`;
      params.push(`%${consignee_name}%`);
      pCount++;
    }
    if (date_from) {
      sql += ` AND document_date >= $${pCount}`;
      params.push(date_from);
      pCount++;
    }
    if (date_to) {
      sql += ` AND document_date <= $${pCount}`;
      params.push(date_to);
      pCount++;
    }
    if (seal_detected !== undefined && seal_detected !== '') {
      sql += ` AND seal_detected = $${pCount}`;
      params.push(seal_detected === 'true' || seal_detected === '1');
      pCount++;
    }
    if (signature_detected !== undefined && signature_detected !== '') {
      sql += ` AND signature_detected = $${pCount}`;
      params.push(signature_detected === 'true' || signature_detected === '1');
      pCount++;
    }
    if (handwriting_detected !== undefined && handwriting_detected !== '') {
      sql += ` AND handwriting_detected = $${pCount}`;
      params.push(handwriting_detected === 'true' || handwriting_detected === '1');
      pCount++;
    }

    if (trip_nos && trip_nos.toString().trim() !== '') {
      const tripList = trip_nos.toString().split(',')
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n));
      
      if (tripList.length > 0) {
        const placeholders = tripList.map((_, i) => `$${pCount + i}`).join(',');
        sql += ` AND trip_no IN (${placeholders})`;
        params.push(...tripList);
        pCount += tripList.length;
      }
    }

    // Full-Text Search or Free Text search
    if (q && q.toString().trim() !== '') {
      const isPg = getIsPostgres();
      if (isPg) {
        // Use PostgreSQL full-text search on search_vector column
        sql += ` AND search_vector @@ plainto_tsquery('english', $${pCount})`;
        params.push(q.toString());
        pCount++;
      } else {
        // Fallback SQLite free-text filter on primary text columns or GIN JSON content mock
        sql += ` AND (
          original_file_name LIKE $${pCount} OR
          document_type LIKE $${pCount} OR
          primary_reference_number LIKE $${pCount} OR
          invoice_number LIKE $${pCount} OR
          lr_number LIKE $${pCount} OR
          vehicle_number LIKE $${pCount} OR
          consignor_name LIKE $${pCount} OR
          consignee_name LIKE $${pCount} OR
          metadata_json LIKE $${pCount}
        )`;
        params.push(`%${q}%`);
        pCount++;
      }
    }

    sql += ' ORDER BY created_at DESC';

    const results = await query(sql, params);

    res.json({
      total_results: results.length,
      documents: results,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.7 Download Document API
 * GET /api/documents/{document_id}/download
 */
router.get('/documents/:document_id/download', async (req: Request, res: Response) => {
  const { document_id } = req.params;

  try {
    const doc = await queryOne(
      'SELECT stored_file_name, original_file_name FROM documents WHERE document_id = $1',
      [document_id]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const user = req.header('X-User') || 'Viewer User';
    await createAuditLog(document_id, 'Download', null, { file: doc.stored_file_name }, user);

    if (isGcsEnabled()) {
      if (!(await fileExists(doc.stored_file_name))) {
        return res.status(404).json({ error: 'Original file not found in cloud storage' });
      }
      res.type(doc.stored_file_name);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${doc.stored_file_name || doc.original_file_name}"`
      );
      const stream = getFileStream(doc.stored_file_name);
      stream.on('error', (err) => {
        console.error(`Error streaming download for ${doc.stored_file_name} from GCS:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error downloading file.' });
        }
      });
      stream.pipe(res);
      return;
    }

    const filePath = getFilePath(doc.stored_file_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Original file not found on disk' });
    }

    res.download(filePath, doc.stored_file_name || doc.original_file_name);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10.7.1 Batch Download Documents as ZIP
 * POST /api/documents/batch-download
 */
router.post('/documents/batch-download', async (req: Request, res: Response) => {
  const { document_ids } = req.body;
  if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
    return res.status(400).json({ error: 'No document IDs provided' });
  }

  try {
    // Fetch all documents
    const placeholders = document_ids.map((_, i) => `$${i + 1}`).join(', ');
    const docs = await query(
      `SELECT document_id, stored_file_name, original_file_name FROM documents WHERE document_id IN (${placeholders})`,
      document_ids
    );

    if (docs.length === 0) {
      return res.status(404).json({ error: 'No matching documents found' });
    }

    // Create a zip archive
    const archive = new archiver.ZipArchive({
      zlib: { level: 9 }
    });

    // Handle archive error
    archive.on('error', (err: any) => {
      throw err;
    });

    // Set headers to stream ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=scandoc_export_${Date.now()}.zip`);

    // Pipe archive data to the response
    archive.pipe(res);

    const user = req.header('X-User') || 'Viewer User';

    // Append files
    for (const doc of docs) {
      if (await fileExists(doc.stored_file_name)) {
        const nameInZip = doc.stored_file_name || doc.original_file_name;
        const fileStream = getFileStream(doc.stored_file_name);
        archive.append(fileStream, { name: nameInZip });
        
        // Log individual download in audit logs
        await createAuditLog(doc.document_id, 'Batch Downloaded', null, { file: doc.stored_file_name }, user);
      } else {
        console.warn(`File not found during batch download: ${doc.stored_file_name}`);
      }
    }

    // Finalize the archive
    await archive.finalize();

  } catch (err: any) {
    console.error('Error in batch download:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});


/**
 * 10.8 Download Metadata JSON API
 * GET /api/documents/{document_id}/metadata/download
 */
router.get('/documents/:document_id/metadata/download', async (req: Request, res: Response) => {
  const { document_id } = req.params;

  try {
    const doc = await queryOne(
      'SELECT metadata_json, original_file_name FROM documents WHERE document_id = $1',
      [document_id]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const user = req.header('X-User') || 'Viewer User';
    await createAuditLog(document_id, 'Download JSON', null, null, user);

    const jsonContent = JSON.stringify(doc.metadata_json || {}, null, 2);
    
    // Set response headers to trigger file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${path.basename(
        doc.original_file_name,
        path.extname(doc.original_file_name)
      )}_metadata.json"`
    );
    res.send(jsonContent);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Audit Logs
 * GET /api/audit-logs
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  const { document_id } = req.query;

  try {
    let sql = 'SELECT * FROM document_audit_logs';
    const params = [];
    if (document_id) {
      sql += ' WHERE document_id = $1';
      params.push(document_id);
    }
    sql += ' ORDER BY changed_at DESC LIMIT 100';

    const logs = await query(sql, params);
    res.json(logs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Configure Multer for Excel Uploads
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(process.cwd(), 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `trip_${uniqueId}${ext}`);
  },
});

const uploadExcel = multer({
  storage: excelStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only Excel files (.xlsx, .xls) are allowed.'));
    }
  },
});

// Helper to format dates correctly for DB storage
const formatExcelDate = (val: any) => {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  return val.toString();
};

/**
 * Upload and Parse Trips Excel API
 * POST /api/trips/upload
 */
router.post(
  '/trips/upload',
  requireRoles(['Admin', 'Ops User']),
  uploadExcel.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const file = req.file;
      const uploadedBy = req.body.uploaded_by || 'Ops User';

      // Read Excel file with cellDates to parse Date objects
      const workbook = XLSX.readFile(file.path, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Parse sheet to JSON array
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (rawRows.length === 0) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Excel sheet is empty.' });
      }

      const uploadId = uuidv4();
      const recordCount = rawRows.length;

      // Create trip_upload parent record first to satisfy foreign key constraint
      await execute(
        `INSERT INTO trip_uploads (upload_id, file_name, record_count, uploaded_by)
         VALUES ($1, $2, $3, $4)`,
        [uploadId, file.originalname, recordCount, uploadedBy]
      );

      // Insert each row
      for (const row of rawRows) {
        const getValue = (keys: string[]) => {
          for (const key of keys) {
            const foundKey = Object.keys(row).find(k => k.trim().toLowerCase() === key.toLowerCase());
            if (foundKey !== undefined) {
              return row[foundKey];
            }
          }
          return null;
        };

        const tripNo = getValue(['Trip No', 'TripNo', 'Trip_No']);
        const tripCreationDate = getValue(['Trip Creation Date', 'TripCreationDate', 'Trip_Creation_Date', 'Creation Date']);
        const tripVehicle = getValue(['Trip Vehicle', 'TripVehicle', 'Vehicle', 'Vehicle No', 'VehicleNumber']);
        const destination = getValue(['Destination']);
        const invNo = getValue(['Inv No', 'InvNo', 'Invoice No', 'InvoiceNumber']);
        const lrNo = getValue(['LR No', 'LRNo', 'LR Number']);
        const deliveryNo1 = getValue(['Delivery No 1', 'DeliveryNo1', 'Delivery No']);
        const deliveryNo2 = getValue(['Delivery No 2', 'DeliveryNo2']);
        const doNumber = getValue(['DO', 'DO No', 'DONumber']);
        const deliveryDate = getValue(['Delivery Date', 'DeliveryDate']);
        const invDate = getValue(['Inv Date', 'InvDate', 'Invoice Date']);
        const invQty = getValue(['Inv Qty', 'InvQty', 'Qty', 'Quantity']);

        const tripId = uuidv4();
        await execute(
          `INSERT INTO trips (
            trip_id, upload_id, trip_no, trip_creation_date, trip_vehicle, destination,
            inv_no, lr_no, delivery_no_1, delivery_no_2, do_number, delivery_date, inv_date, inv_qty
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            tripId,
            uploadId,
            tripNo !== null ? parseInt(tripNo.toString(), 10) : null,
            formatExcelDate(tripCreationDate),
            tripVehicle !== null ? tripVehicle.toString().trim() : null,
            destination !== null ? destination.toString().trim() : null,
            invNo !== null ? invNo.toString().trim() : null,
            lrNo !== null ? lrNo.toString().trim() : null,
            deliveryNo1 !== null ? deliveryNo1.toString().trim() : null,
            deliveryNo2 !== null ? deliveryNo2.toString().trim() : null,
            doNumber !== null ? doNumber.toString().trim() : null,
            formatExcelDate(deliveryDate),
            formatExcelDate(invDate),
            invQty !== null ? parseFloat(invQty.toString()) : null,
          ]
        );
      }

      // Clean up uploaded file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // Run batch trip-linking for any pending documents now that we have loaded new trips
      await matchAllPendingTrips();

      res.json({
        success: true,
        upload_id: uploadId,
        record_count: recordCount,
        file_name: file.originalname,
      });
    } catch (err: any) {
      console.error('Error uploading trips Excel:', err);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Get Trip Records API
 * GET /api/trips
 */
router.get('/trips', async (req: Request, res: Response) => {
  const { search } = req.query;
  try {
    let sql = 'SELECT * FROM trips';
    const params = [];
    if (search && search.toString().trim() !== '') {
      sql += ` WHERE trip_vehicle LIKE $1 OR destination LIKE $1 OR inv_no LIKE $1 OR lr_no LIKE $1 OR trip_no LIKE $1`;
      params.push(`%${search}%`);
    }
    sql += ' ORDER BY uploaded_at DESC';
    const trips = await query(sql, params);
    res.json(trips);
  } catch (err: any) {
    console.error('Error fetching trips:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Trip Upload Audits API
 * GET /api/trips/uploads
 */
router.get('/trips/uploads', async (req: Request, res: Response) => {
  try {
    const uploads = await query(
      `SELECT * FROM trip_uploads ORDER BY uploaded_at DESC`
    );
    res.json(uploads);
  } catch (err: any) {
    console.error('Error fetching trip uploads:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete Trip Upload Batch API
 * DELETE /api/trips/uploads/{upload_id}
 */
router.delete(
  '/trips/uploads/:upload_id',
  requireRoles(['Admin']),
  async (req: Request, res: Response) => {
    const { upload_id } = req.params;
    try {
      await execute('DELETE FROM trip_uploads WHERE upload_id = $1', [upload_id]);
      res.json({ success: true, message: 'Upload batch and associated trips deleted successfully.' });
    } catch (err: any) {
      console.error('Error deleting upload batch:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Match a document to a trip record based on Invoice No, LR No, or DO No
 */
export async function matchTripForDocument(documentId: string): Promise<void> {
  try {
    const doc = await queryOne(
      `SELECT document_id, invoice_number, lr_number, delivery_number, primary_reference_number, stored_file_name, original_file_name 
       FROM documents WHERE document_id = $1`,
      [documentId]
    );
    if (!doc) return;

    let matchedTrip = null;

    // Match by Invoice Number
    if (doc.invoice_number && doc.invoice_number.trim() !== '') {
      matchedTrip = await queryOne(
        `SELECT * FROM trips WHERE inv_no = $1 LIMIT 1`,
        [doc.invoice_number.trim()]
      );
    }

    // Match by LR Number
    if (!matchedTrip && doc.lr_number && doc.lr_number.trim() !== '') {
      matchedTrip = await queryOne(
        `SELECT * FROM trips WHERE lr_no = $1 LIMIT 1`,
        [doc.lr_number.trim()]
      );
    }

    // Match by Delivery Number / DO
    if (!matchedTrip && doc.delivery_number && doc.delivery_number.trim() !== '') {
      matchedTrip = await queryOne(
        `SELECT * FROM trips WHERE do_number = $1 OR delivery_no_1 = $1 OR delivery_no_2 = $1 LIMIT 1`,
        [doc.delivery_number.trim()]
      );
    }

    if (matchedTrip) {
      const tripNo = matchedTrip.trip_no;

      // Update trips table with primary reference number
      await execute(
        `UPDATE trips SET primary_reference_number = $1 WHERE trip_id = $2`,
        [doc.primary_reference_number, matchedTrip.trip_id]
      );

      // Update documents table with trip_no
      await execute(
        `UPDATE documents SET trip_no = $1 WHERE document_id = $2`,
        [tripNo, documentId]
      );

      // Rename physical file on disk with Trip Number
      if (tripNo) {
        const ext = path.extname(doc.original_file_name || doc.stored_file_name);
        const newFileNameBase = `Trip_${tripNo}`;
        const targetFileName = `${newFileNameBase}${ext}`;
        
        const uploadsDir = path.resolve(process.cwd(), 'uploads');
        const currentPath = path.join(uploadsDir, doc.stored_file_name);
        
        let finalLogicalName = targetFileName;
        let attempt = 1;

        while (
          fs.existsSync(path.join(uploadsDir, finalLogicalName)) && 
          finalLogicalName !== doc.stored_file_name
        ) {
          finalLogicalName = `${newFileNameBase}_${attempt}${ext}`;
          attempt++;
        }

        const finalTargetPath = path.join(uploadsDir, finalLogicalName);

        if (fs.existsSync(currentPath)) {
          fs.renameSync(currentPath, finalTargetPath);
          console.log(`Renamed file with Trip Number: ${doc.stored_file_name} -> ${finalLogicalName}`);
          
          await execute(
            `UPDATE documents SET stored_file_name = $1, file_path = $2 WHERE document_id = $3`,
            [finalLogicalName, finalTargetPath, documentId]
          );
        }
      }
    }
  } catch (err) {
    console.error(`Error in matchTripForDocument for ${documentId}:`, err);
  }
}

/**
 * Run trip matching on all documents that don't have a trip_no yet
 */
export async function matchAllPendingTrips(): Promise<void> {
  try {
    const docs = await query('SELECT document_id FROM documents WHERE trip_no IS NULL');
    console.log(`Running batch trip matching for ${docs.length} pending documents...`);
    for (const d of docs) {
      await matchTripForDocument(d.document_id);
    }
  } catch (err) {
    console.error('Error in matchAllPendingTrips:', err);
  }
}

/**
 * Check if the document has duplicate invoice_number, delivery_number (DO), or trip_no
 * compared to other existing documents in the database.
 */
export async function runDuplicateCheckingAndFlagging(documentId: string): Promise<void> {
  try {
    const doc = await queryOne(
      `SELECT document_id, invoice_number, lr_number, delivery_number, trip_no, metadata_json, extraction_status 
       FROM documents WHERE document_id = $1`,
      [documentId]
    );
    if (!doc) return;

    const invoiceNo = doc.invoice_number;
    const deliveryNo = doc.delivery_number;
    const tripNo = doc.trip_no;

    const duplicateFlags: string[] = [];

    if (invoiceNo && invoiceNo.trim() !== '') {
      const dupInvoice = await queryOne(
        'SELECT document_id FROM documents WHERE invoice_number = $1 AND document_id != $2 LIMIT 1',
        [invoiceNo.trim(), documentId]
      );
      if (dupInvoice) {
        duplicateFlags.push(`Duplicate Invoice Number detected: ${invoiceNo.trim()}`);
      }
    }

    if (deliveryNo && deliveryNo.trim() !== '') {
      const dupDO = await queryOne(
        'SELECT document_id FROM documents WHERE delivery_number = $1 AND document_id != $2 LIMIT 1',
        [deliveryNo.trim(), documentId]
      );
      if (dupDO) {
        duplicateFlags.push(`Duplicate Delivery Number (DO) detected: ${deliveryNo.trim()}`);
      }
    }

    if (tripNo) {
      const dupTrip = await queryOne(
        'SELECT document_id FROM documents WHERE trip_no = $1 AND document_id != $2 LIMIT 1',
        [tripNo, documentId]
      );
      if (dupTrip) {
        duplicateFlags.push(`Duplicate Trip Number detected: ${tripNo}`);
      }
    }

    let metadata = typeof doc.metadata_json === 'string' ? JSON.parse(doc.metadata_json) : (doc.metadata_json || {});
    
    // Start with existing review_flags, filtering out previous duplicate warnings
    let existingFlags: string[] = metadata.review_flags || [];
    existingFlags = existingFlags.filter(flag => 
      !flag.startsWith('Duplicate Invoice Number detected') &&
      !flag.startsWith('Duplicate Delivery Number (DO) detected') &&
      !flag.startsWith('Duplicate Trip Number detected')
    );

    // Combine remaining flags with new duplicate flags
    const finalFlags = [...existingFlags, ...duplicateFlags];
    metadata.review_flags = finalFlags;

    let finalStatus = doc.extraction_status;
    if (duplicateFlags.length > 0) {
      if (finalStatus !== 'Failed') {
        finalStatus = 'Needs Review';
      }
    } else {
      // If duplicates are cleared, and there are no other active review flags, we can transition it out of Needs Review to Approved
      if (finalFlags.length === 0 && finalStatus === 'Needs Review') {
        finalStatus = 'Approved';
      }
    }

    await execute(
      'UPDATE documents SET metadata_json = $1, extraction_status = $2 WHERE document_id = $3',
      [metadata, finalStatus, documentId]
    );

    console.log(`Duplicate checking complete for ${documentId}. Duplicate flags found:`, duplicateFlags);
  } catch (err) {
    console.error(`Error in runDuplicateCheckingAndFlagging for ${documentId}:`, err);
  }
}

/**
 * GET /api/reports/token-usage
 * Fetches token metrics and costs aggregates
 */
router.get('/reports/token-usage', requireRoles(['Admin', 'Ops User', 'Viewer', 'Auditor']), async (req: Request, res: Response) => {
  try {
    const stats = await queryOne(`
      SELECT 
        COUNT(document_id) as total_documents,
        SUM(COALESCE(prompt_tokens, 0)) as total_prompt_tokens,
        SUM(COALESCE(completion_tokens, 0)) as total_completion_tokens,
        SUM(COALESCE(total_tokens, 0)) as total_tokens,
        SUM(COALESCE(token_cost, 0.0)) as total_cost
      FROM documents
    `);

    const totalDocs = stats ? Number(stats.total_documents || 0) : 0;
    const totalPrompt = stats ? Number(stats.total_prompt_tokens || 0) : 0;
    const totalCompletion = stats ? Number(stats.total_completion_tokens || 0) : 0;
    const totalTokens = stats ? Number(stats.total_tokens || 0) : 0;
    const totalCost = stats ? Number(stats.total_cost || 0.0) : 0.0;
    const avgCost = totalDocs > 0 ? (totalCost / totalDocs) : 0.0;

    res.json({
      total_documents: totalDocs,
      total_prompt_tokens: totalPrompt,
      total_completion_tokens: totalCompletion,
      total_tokens: totalTokens,
      total_cost: totalCost,
      average_cost_per_document: avgCost
    });
  } catch (err: any) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Failed to retrieve token usage statistics.' });
  }
});

export default router;

