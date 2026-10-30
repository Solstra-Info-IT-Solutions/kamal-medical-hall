#!/usr/bin/env node
import mongoose from 'mongoose';
import 'dotenv/config';
import { config } from './src/config.js';
import { User } from './src/models/User.js';
import { Order } from './src/models/Order.js';
import { StoreSettings } from './src/models/StoreSettings.js';
import { OtpCode } from './src/models/OtpCode.js';
import { Notification } from './src/models/Notification.js';
import { ChatThread } from './src/models/ChatThread.js';
import { ChatMessage } from './src/models/ChatMessage.js';

async function connectMongo() {
  if (!config.mongoUrl) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  await mongoose.connect(config.mongoUrl, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    bufferCommands: false,
  });

  console.log('✅ MongoDB connected successfully');
}

async function seedDatabase() {
  console.log('\n📦 Seeding initial data...\n');

  // Create admin user
  const adminExists = await User.findOne({ phone: '9000000001' });
  if (!adminExists) {
    await User.create({
      phone: '9000000001',
      role: 'admin',
      name: 'Store Admin',
    });
    console.log('  ✓ Admin user created');
  } else {
    console.log('  ✓ Admin user exists');
  }

  // Create delivery partners (dev only)
  if (config.authMode === 'dev') {
    for (const [phone, name] of [
      ['9000000002', 'Staff One'],
      ['9000000003', 'Staff Two'],
    ]) {
      const exists = await User.findOne({ phone });
      if (!exists) {
        await User.create({ phone, role: 'delivery_partner', name });
        console.log(`  ✓ Delivery partner created: ${name}`);
      }
    }
  }

  // Create store settings
  const settingsExist = await StoreSettings.countDocuments();
  if (settingsExist === 0) {
    await StoreSettings.create({
      isOpen: true,
      openingTime: '09:00',
      closingTime: '21:00',
      address: 'Mansarovar, Jaipur',
      phone: '9000000001',
    });
    console.log('  ✓ Store settings created');
  } else {
    console.log('  ✓ Store settings exist');
  }

  console.log('\n✅ Database seeding complete!\n');
}

async function runMigration() {
  try {
    console.log('\n🚀 Starting MongoDB Migration...\n');

    if (!config.mongoUrl) {
      throw new Error('MONGODB_URI is not set. Please add it to your .env file.');
    }

    await connectMongo();

    // Check connection
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB connection failed');
    }

    await seedDatabase();

    // Verify all collections exist
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📋 Collections in database:');
    collections.forEach(c => console.log(`  - ${c.name}`));

    console.log('\n✅ Migration successful! Your database is ready.\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();