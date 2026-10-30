import mongoose from 'mongoose';
import { config } from './config.js';

// MongoDB connection
let isConnected = false;

export async function connectToMongo() {
  if (isConnected) return true;

  if (!config.mongoUrl) {
    throw new Error('MONGODB_URI is required for MongoDB mode');
  }

  try {
    await mongoose.connect(config.mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 15000,
      bufferMaxEntries: 0,
      bufferCommands: false,
    });
    isConnected = true;
    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

export function isMongoConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

// Transaction helper for MongoDB
export async function tx<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

export type Queryable = mongoose.Connection;
export const pool = {
  query: () => ({ rows: [] }),
  connect: () => ({ release: () => {} }),
  on: () => {},
};

// MongoDB-only - remove PostgreSQL types
export type TxClient = mongoose.ClientSession;
export const hasAfterCommit = (_db: unknown): _db is TxClient => false;