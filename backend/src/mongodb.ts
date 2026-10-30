import mongoose from 'mongoose';
import { config } from './config.js';

let isConnected = false;

export async function connectMongoDB() {
  if (isConnected) return;

  const uri = config.mongoUrl;
  if (!uri) {
    throw new Error('MONGODB_URI is required in environment variables');
  }

  await mongoose.connect(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    bufferMaxEntries: 0,
    bufferCommands: false,
  });

  isConnected = true;
  console.log('MongoDB connected successfully');

  // Handle disconnection
  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
    isConnected = false;
  });

  // Handle errors
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });
}

export function isConnectedToMongo() {
  return isConnected && mongoose.connection.readyState === 1;
}

// Graceful shutdown
process.on('SIGINT', async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
  }
});