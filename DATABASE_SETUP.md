# Database Setup - Supabase Recreation Guide

## Issue Resolved
Your Supabase project was corrupted. This guide helps you recreate it and restore the database.

## Step 1: Create New Supabase Project

1. Go to https://supabase.com/dashboard ← **sign in**
2. Click **New Project**
3. Configure:
   - **Project name:** `kamal-medical-hall`
   - **Database password:** Set a secure password (save this!)
   - **Region:** `Asia Southeast (Mumbai)` ← *Important for lowest latency*
4. Click **Create new project**
5. Wait 2-3 minutes for creation

## Step 2: Get Database Connection String

1. In Supabase Dashboard → **Project Settings** → **Database** → **Connection pooler**
2. Copy the **Connection string**:
   ```
   postgresql://postgres:YOUR_PASSWORD@db.kamal-medical-hall.supabase.co:5432/kamal-medical-hall
   ```

## Step 3: Apply Database Schema

1. In Supabase Dashboard → **SQL Editor**
2. **Delete all existing tables** (if any remain from corrupted project):
   ```sql
   drop schema public cascade;
   create schema public;
   create extension if not exists "uuid-ossp";
   ```
3. Copy and **paste this entire file**: `backend/migrations/20240101000000_initial_schema.sql`
4. Click **Run**

## Step 4: Verify Schema

After running, you should see tables like:
- `users`
- `orders`
- `prescriptions`
- `payments`
- `chat_threads`
- `notifications`
- etc.

## Step 5: Update Vercel Environment Variables

Go to Vercel Dashboard → **Your Project** → **Settings** → **Environment Variables**

### Production Environment

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@db.kamal-medical-hall.supabase.co:5432/kamal-medical-hall` |
| `JWT_SECRET` | `use-somesecret-minimum32chars` |
| `AUTH_MODE` | `dev` |
| `PUBLIC_URL` | `https://kamal-medical-hall-api.vercel.app` |
| `CORS_ORIGINS` | `https://kamal-medical-hall.vercel.app` |

### Deployment

1. Go to Vercel → **Deployments**
2. Click **Redeploy** or **Purge Cache & Redeploy**
3. Wait for deployment to complete

## Step 6: Test the API

After deployment, test:
```
GET https://kamal-medical-hall-api.vercel.app/health
```
Should return: `{"ok":true}`

## If You Encounter Errors

### "DATABASE_URL is required"
- Check that `DATABASE_URL` is set correctly in Vercel
- Verify the connection string format

### "password authentication failed"
- The database password may have changed
- Reset in Supabase → Settings → Database → Password

### "Connection refused"
- Region might not match
- Ensure you're using the pooler connection string (port 5432)

## Mobile App Update

After Supabase is recreated, update the mobile app's `.env`:
```bash
EXPO_PUBLIC_API_URL=https://kamal-medical-hall-api.vercel.app
EXPO_PUBLIC_AUTH_MODE=dev
```

Then rebuild the mobile app.