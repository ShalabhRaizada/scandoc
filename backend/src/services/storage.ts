import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { execute } from '../config/db';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export interface FileInfo {
  filename: string;
  originalname: string;
  path: string;
  mimetype: string;
  size: number;
}

/**
 * Get the full path for a file
 */
export function getFilePath(filename: string): string {
  return path.join(UPLOAD_DIR, filename);
}

/**
 * Delete a file from disk
 */
export function deleteFile(filename: string): void {
  const filePath = getFilePath(filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Determine a logical name for the file based on the extraction metadata
 * Rules:
 * 1. Invoice Number -> {invoice_number}_Invoice.{ext}
 * 2. LR / Consignment Note Number -> {lr_number}_LR.{ext}
 * 3. Delivery Number -> {delivery_number}_Delivery.{ext}
 * 4. Vehicle Number + Document Date -> {vehicle_number}_{document_date}_Doc.{ext}
 * 5. Original file name
 */
export function determineLogicalName(
  originalName: string,
  metadata: {
    invoice_number?: string | null;
    lr_number?: string | null;
    consignment_note_number?: string | null;
    delivery_number?: string | null;
    vehicle_number?: string | null;
    document_date?: string | null;
  }
): string {
  const ext = path.extname(originalName);
  const cleanStr = (s: string | null | undefined) => s ? s.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';

  const inv = cleanStr(metadata.invoice_number);
  const lr = cleanStr(metadata.lr_number || metadata.consignment_note_number);
  const deliv = cleanStr(metadata.delivery_number);
  const veh = cleanStr(metadata.vehicle_number);
  const date = cleanStr(metadata.document_date);

  let baseName = '';
  if (inv) {
    baseName = `${inv}_Invoice`;
  } else if (lr) {
    baseName = `${lr}_LR`;
  } else if (deliv) {
    baseName = `${deliv}_Delivery`;
  } else if (veh && date) {
    baseName = `${veh}_${date}_Doc`;
  } else {
    // Fall back to original file name without extension
    const nameWithoutExt = path.basename(originalName, ext);
    baseName = cleanStr(nameWithoutExt) || 'document';
  }

  // Ensure ext starts with dot
  const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${baseName}${dotExt}`;
}

/**
 * Rename a document file logically on disk and update its DB record
 */
export async function renameDocumentLogically(
  documentId: string,
  originalFileName: string,
  currentFileName: string,
  metadata: {
    invoice_number?: string | null;
    lr_number?: string | null;
    consignment_note_number?: string | null;
    delivery_number?: string | null;
    vehicle_number?: string | null;
    document_date?: string | null;
  }
): Promise<string> {
  const logicalName = determineLogicalName(originalFileName, metadata);
  const currentPath = getFilePath(currentFileName);
  const targetPath = getFilePath(logicalName);

  // If the target file already exists and is different, we can append a timestamp or counter to avoid overwriting
  let finalLogicalName = logicalName;
  let attempt = 1;
  const ext = path.extname(logicalName);
  const base = path.basename(logicalName, ext);

  while (fs.existsSync(getFilePath(finalLogicalName)) && finalLogicalName !== currentFileName) {
    finalLogicalName = `${base}_${attempt}${ext}`;
    attempt++;
  }

  const finalTargetPath = getFilePath(finalLogicalName);

  if (fs.existsSync(currentPath)) {
    fs.renameSync(currentPath, finalTargetPath);
    console.log(`Renamed file: ${currentFileName} -> ${finalLogicalName}`);
  } else {
    console.warn(`File not found to rename: ${currentPath}`);
  }

  // Update in database
  await execute(
    `UPDATE documents 
     SET stored_file_name = $1, file_path = $2 
     WHERE document_id = $3`,
    [finalLogicalName, finalTargetPath, documentId]
  );

  return finalLogicalName;
}

/**
 * Preprocess uploaded image documents by auto-cropping margins (trimming)
 * and enhancing text contrast/sharpness for optimized OCR extraction.
 * Overwrites the original file in-place if preprocessed.
 */
export async function preprocessImageIfNeeded(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'];
  
  if (!imageExtensions.includes(ext)) {
    return false; // Skip if not an image (e.g., PDF)
  }

  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`preprocessImageIfNeeded: File not found at ${filePath}`);
      return false;
    }

    console.log(`Preprocessing image file for auto-crop and enhancement: ${filePath}`);
    
    // Read original file buffer
    const buffer = fs.readFileSync(filePath);

    // Apply auto-cropping & enhancements with sharp:
    // 1. .trim() auto-crops uniform margins/borders based on background threshold
    // 2. .normalize() stretches dynamic range to fix uneven lighting/shadows
    // 3. .sharpen() sharpens text edges for more accurate OCR/AI processing
    const processedBuffer = await sharp(buffer)
      .trim()
      .normalize()
      .sharpen({
        sigma: 1.5,
        m1: 1.0,
        m2: 2.0
      })
      .toBuffer();

    // Overwrite original file in-place
    fs.writeFileSync(filePath, processedBuffer);
    console.log(`Successfully auto-cropped and enhanced image: ${filePath}`);
    return true;
  } catch (err) {
    console.error(`Error during image preprocessing for ${filePath}:`, err);
    return false;
  }
}

