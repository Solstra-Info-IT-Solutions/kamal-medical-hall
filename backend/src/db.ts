
import mongoose from 'mongoose';
import { config } from './config.js';
import {
  resetAfterCommit,
  runAfterCommit,
  discardAfterCommit,
} from './transactionHooks.js';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectToMongo(): Promise<boolean> {
  if (isMongoConnected()) return true;

  if (!config.mongoUrl) {
    throw new Error('MONGODB_URI is required for MongoDB mode');
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 15000,
      bufferCommands: false,
    }).catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  try {
    await connectionPromise;
    console.log('MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  } finally {
    if (isMongoConnected()) {
      connectionPromise = null;
    }
  }
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function tx<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();

  try {
    let result!: T;

    await session.withTransaction(async () => {
      // MongoDB may retry this callback. Discard callbacks
      // registered during any previous failed attempt.
      resetAfterCommit(session);

      result = await fn(session);
    });

    // Execute notifications and other side effects only
    // after MongoDB confirms the transaction has committed.
    await runAfterCommit(session);

    return result;
  } catch (error) {
    discardAfterCommit(session);
    throw error;
  } finally {
    await session.endSession();
  }
}

export type TxClient = mongoose.ClientSession;
