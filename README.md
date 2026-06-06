# SCANDOC Logistics Document Processor

SCANDOC is a modern web application for bulk uploading scanned logistics documents (invoices, lorry receipts, PODs, GRNs, e-way bills, weighment slips), extracting metadata using OCR/AI, detecting visual annotations (seals/stamps, signatures, handwriting), editing metadata, and full-text searching documents.

## Technical Architecture

- **Frontend:** React + TypeScript + Vanilla CSS (Vite-based)
- **Backend:** Node.js Express server + TypeScript
- **Database:** PostgreSQL with GIN full-text index support, with a seamless fallback to a local SQLite database file (`scandoc.db`) for instant zero-dependency execution.
- **AI OCR Service:** Multimodal extraction using Google Gemini or OpenAI vision APIs, with a high-fidelity logistics simulation engine fallback when API keys are absent.
- **File Storage:** Local disk storage in the `/backend/uploads` directory.

---

## Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- (Optional) [Docker Desktop](https://www.docker.com/) for running PostgreSQL

### 2. Configure Environment (Optional)
A `.env` file is generated inside `/backend`.
If you want to run with PostgreSQL:
1. Start the PostgreSQL service using docker-compose:
   ```bash
   docker-compose up -d
   ```
2. Uncomment the database lines inside `/backend/.env`.

If you want to test with real AI extraction, set:
- `GEMINI_API_KEY` or `OPENAI_API_KEY` inside `/backend/.env`.

*If these are not set, the application will use the high-fidelity simulator fallback and run successfully with local files.*

### 3. Install & Start Application

To start the application, run:

1. **Start the Backend Server:**
   ```bash
   cd backend
   npm run dev
   ```
   The backend will run on `http://localhost:3001`.

2. **Start the Frontend client:**
   ```bash
   cd frontend
   npm run dev
   ```
   The client will open in your browser (usually `http://localhost:5173` or similar).

---

## Verifying Features & Role-Based Access Control (RBAC)

1. **Role Switcher Dropdown:**
   Located in the top right of the navbar. You can toggle between:
   - **Admin / Ops User:** Full access to upload documents, review & edit metadata fields, save line items, approve files, and download.
   - **Viewer:** Read-only search and download documents/metadata JSON.
   - **Auditor:** View audit logs and download data only.
   
2. **Bulk Upload Page:**
   - Drag-and-drop up to 10 files (PDF or images like JPG, PNG, WEBP).
   - Enter an optional Batch Name and Customer Name.
   - Click **Upload & Extract**.
   
3. **Processing Status Page:**
   - Shows live polling progress as documents are uploaded -> processed -> extracted.
   - Summarizes counts of successes, failures, and items needing review.
   
4. **Document Review Screen:**
   - Double-column layout: visual document panel on the left, editable tabbed panels on the right.
   - Allows editing fields, adding/deleting line items, and inspecting detected handwriting/seal flags.
   - Mark as approved or save draft.
   
5. **Document Search Page:**
   - Full-text search and specific filters matching vehicle numbers, consignee/consignor, seals, signatures, and dates.
   - Result table with direct download options for files and extracted JSON.
