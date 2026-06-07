import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Readable } from 'stream';
import { Storage } from '@google-cloud/storage';
import { execute } from '../config/db';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || '';

// Ensure upload directory exists locally (used for temporary staging/local dev)
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Initialize GCS client if bucket is configured
let gcsStorage: Storage | null = null;
if (BUCKET_NAME) {
  console.log(`Google Cloud Storage enabled. Target bucket: ${BUCKET_NAME}`);
  gcsStorage = new Storage();
}

export interface FileInfo {
  filename: string;
  originalname: string;
  path: string;
  mimetype: string;
  size: number;
}

/**
 * Check if GCS storage is enabled
 */
export function isGcsEnabled(): boolean {
  return !!BUCKET_NAME && gcsStorage !== null;
}

/**
 * Get the local full path for a file (for temporary uploads/local storage)
 */
export function getFilePath(filename: string): string {
  return path.join(UPLOAD_DIR, filename);
}

/**
 * Upload a local file to GCS
 */
export async function uploadToGcs(localFilePath: string, gcsFileName: string): Promise<void> {
  if (!isGcsEnabled() || !gcsStorage) {
    return;
  }
  await gcsStorage.bucket(BUCKET_NAME).upload(localFilePath, {
    destination: gcsFileName,
    metadata: {
      cacheControl: 'public, max-age=31536000',
    },
  });
  console.log(`Uploaded to GCS: ${localFilePath} -> gs://${BUCKET_NAME}/${gcsFileName}`);
}

/**
 * Check if file exists (either in GCS or locally)
 */
export async function fileExists(filename: string): Promise<boolean> {
  if (isGcsEnabled() && gcsStorage) {
    try {
      const [exists] = await gcsStorage.bucket(BUCKET_NAME).file(filename).exists();
      return exists;
    } catch (err) {
      console.error(`Error checking GCS existence for ${filename}:`, err);
      return false;
    }
  } else {
    return fs.existsSync(getFilePath(filename));
  }
}

/**
 * Delete a file (from GCS if enabled, otherwise from local disk)
 */
export async function deleteFile(filename: string): Promise<void> {
  if (isGcsEnabled() && gcsStorage) {
    try {
      await gcsStorage.bucket(BUCKET_NAME).file(filename).delete();
      console.log(`Deleted GCS file: gs://${BUCKET_NAME}/${filename}`);
    } catch (err: any) {
      console.error(`Error deleting GCS file ${filename}:`, err.message);
    }
  } else {
    const filePath = getFilePath(filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Get a read stream for a file (GCS stream or local fs stream)
 */
export function getFileStream(filename: string): Readable {
  if (isGcsEnabled() && gcsStorage) {
    return gcsStorage.bucket(BUCKET_NAME).file(filename).createReadStream();
  } else {
    return fs.createReadStream(getFilePath(filename));
  }
}

/**
 * Get a pre-signed retrieval URL for the document (GCS signed URL or local HTTP URL)
 */
export async function getSignedUrlForFile(filename: string): Promise<string> {
  if (isGcsEnabled() && gcsStorage) {
    const [url] = await gcsStorage
      .bucket(BUCKET_NAME)
      .file(filename)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes expiry
      });
    return url;
  } else {
    return `http://localhost:3001/uploads/${filename}`;
  }
}

/**
 * Determine a logical name for the file based on the extraction metadata
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
    const nameWithoutExt = path.basename(originalName, ext);
    baseName = cleanStr(nameWithoutExt) || 'document';
  }

  const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${baseName}${dotExt}`;
}

/**
 * Rename a document file logically (on GCS or local disk) and update DB record
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

  let finalLogicalName = logicalName;
  let attempt = 1;
  const ext = path.extname(logicalName);
  const base = path.basename(logicalName, ext);

  // Check existence to avoid collisions
  while (await fileExists(finalLogicalName) && finalLogicalName !== currentFileName) {
    finalLogicalName = `${base}_${attempt}${ext}`;
    attempt++;
  }

  const dbFilePath = isGcsEnabled() 
    ? `gs://${BUCKET_NAME}/${finalLogicalName}` 
    : getFilePath(finalLogicalName);

  if (isGcsEnabled() && gcsStorage) {
    // GCS Renaming flow (copy to target and delete source if source exists)
    try {
      const bucket = gcsStorage.bucket(BUCKET_NAME);
      const sourceFile = bucket.file(currentFileName);
      
      const [sourceExists] = await sourceFile.exists();
      if (sourceExists) {
        if (currentFileName !== finalLogicalName) {
          await sourceFile.copy(bucket.file(finalLogicalName));
          await sourceFile.delete();
          console.log(`Renamed GCS object: ${currentFileName} -> ${finalLogicalName}`);
        }
      } else {
        // If source file doesn't exist in GCS, check if it exists locally to upload (staging upload)
        const localPath = getFilePath(currentFileName);
        if (fs.existsSync(localPath)) {
          await uploadToGcs(localPath, finalLogicalName);
          fs.unlinkSync(localPath); // delete local staging copy
        } else {
          console.warn(`File not found in GCS or locally: ${currentFileName}`);
        }
      }
    } catch (err: any) {
      console.error(`Error during GCS rename operation for ${currentFileName}:`, err.message);
    }
  } else {
    // Local Renaming flow
    const currentPath = getFilePath(currentFileName);
    const targetPath = getFilePath(finalLogicalName);

    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, targetPath);
      console.log(`Renamed local file: ${currentFileName} -> ${finalLogicalName}`);
    } else {
      console.warn(`Local file not found to rename: ${currentPath}`);
    }
  }

  // Update in database
  await execute(
    `UPDATE documents 
     SET stored_file_name = $1, file_path = $2 
     WHERE document_id = $3`,
    [finalLogicalName, dbFilePath, documentId]
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
    
    const buffer = fs.readFileSync(filePath);

    // Apply auto-cropping & enhancements with sharp:
    const processedBuffer = await sharp(buffer)
      .trim()
      .normalize()
      .sharpen({
        sigma: 1.5,
        m1: 1.0,
        m2: 2.0
      })
      .toBuffer();

    fs.writeFileSync(filePath, processedBuffer);
    console.log(`Successfully auto-cropped and enhanced image: ${filePath}`);
    return true;
  } catch (err) {
    console.error(`Error during image preprocessing for ${filePath}:`, err);
    return false;
  }
}
