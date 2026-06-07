import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './config/db';
import apiRouter from './routes/api';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import { isGcsEnabled, getSignedUrlForFile } from './services/storage';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: '*', // Allow all origins for dev simplicity
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());

// Serve static uploaded files (crucial for React previewing)
const uploadsPath = path.resolve(process.cwd(), 'uploads');

// Intercept uploads path and redirect to GCS if GCS storage is active
app.get('/uploads/:filename', async (req, res, next) => {
  if (isGcsEnabled()) {
    try {
      const signedUrl = await getSignedUrlForFile(req.params.filename);
      return res.redirect(signedUrl);
    } catch (err) {
      console.error('Error generating pre-signed URL for static GCS redirect:', err);
      return res.status(500).send('Error retrieving file from cloud storage.');
    }
  }
  next();
});

app.use('/uploads', express.static(uploadsPath));

// API routers (order is critical to prevent global auth interception on login/me routes)
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', apiRouter);

// Start server
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(` SCANDOC Backend server running on port ${PORT}`);
      console.log(` Static uploads served at: http://localhost:${PORT}/uploads`);
      console.log(`===============================================`);
    });
  } catch (err) {
    console.error('Failed to start SCANDOC server:', err);
    process.exit(1);
  }
}

start();
