import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './config/db';
import apiRouter from './routes/api';
import authRouter from './routes/auth';
import usersRouter from './routes/users';

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
app.use('/uploads', express.static(uploadsPath));

// API routers
app.use('/api', apiRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);

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
