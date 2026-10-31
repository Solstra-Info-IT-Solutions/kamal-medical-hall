
import {
  connectToMongo,
  isMongoConnected,
} from './db.js';

/**
 * Backward-compatible MongoDB connection function.
 * Uses the centralized connection manager in db.ts.
 */
export async function connectMongoDB(): Promise<void> {
  await connectToMongo();
}

/**
 * Check MongoDB connection status.
 */
export function isConnectedToMongo(): boolean {
  return isMongoConnected();
}
