# MongoDB Atlas Migration Guide - Kamal Medical Hall

## Overview
This guide provides step-by-step instructions to migrate from Supabase PostgreSQL to MongoDB Atlas.

## ⚠️ Important Notes
- This is a significant migration requiring code changes
- Estimated time: 3-5 days
- You'll need to update all database queries
- All existing data needs migration

---

## Step 1: Create MongoDB Atlas Cluster

### 1.1 Sign Up
- Go to: https://www.mongodb.com/cloud/atlas
- Sign up for free tier (M0)

### 1.2 Create Cluster
```
Provider: AWS
Region: Mumbai (ap-south-1) - for lowest latency in India
Cluster Tier: M0 Free (or M10 for production)
Database Name: kamal-medical-hall
Collection Name: (will be created automatically)
```

### 1.3 Create Database User
```
Username: kamal_user
Password: StrongPassword123!
Authentication Database: admin
Database User Privileges: Read and write to any database
```

### 1.4 Network Access
- Go to Security → Network Access → IP Whitelist
- Add your IP: Your current IP (or `0.0.0.0/0` for development)

---

## Step 2: Get Connection String

In Atlas Dashboard:
```
Clusters → your-cluster → Connect → Connect your application

Driver: Node.js
Version: 20.0.0+

Connection String:
mongodb+srv://kamal_user:StrongPassword123!@kamal-medical-hall.mongodb.net/kamal-medical-hall?retryWrites=true&w=majority
```

---

## Step 3: Install Dependencies

```bash
cd backend
npm install mongoose
```

---

## Step 4: Configure Environment Variables

Create/update `.env` file in backend folder:

```bash
# MongoDB Connection
MONGODB_URI=mongodb+srv://kamal_user:your_password@kamal-medical-hall.mongodb.net/kamal-medical-hall?retryWrites=true&w=majority

# Keep other existing variables
NODE_ENV=production
JWT_SECRET=your-32-character-secret-key
AUTH_MODE=dev
PUBLIC_URL=https://api.kamalmedicalhall.com
CORS_ORIGINS=https://www.kamalmedicalhall.com
```

---

## Step 5: Code Changes Required

### Files Created (MongoDB Models):
- `src/models/User.ts`
- `src/models/Order.ts`
- `src/models/StoreSettings.ts`
- `src/models/OtpCode.ts`
- `src/models/Notification.ts`
- `src/models/ChatThread.ts`
- `src/models/ChatMessage.ts`

### Files Modified:
- `src/config.ts` - Added MongoDB URL support
- `src/server.ts` - Add MongoDB connection initialization

---

## Step 6: MongoDB Collections Structure

MongoDB will automatically create these collections:

| Collection | Purpose |
|------------|---------|
| `users` | Customer, admin, and partner accounts |
| `orders` | All orders with status tracking |
| `prescriptions` | Medical prescriptions |
| `notifications` | Push notifications |
| `chat_threads` | Live chat support |
| `chat_messages` | Chat message history |
| `store_settings` | Store configuration |
| `otp_codes` | OTP verification codes |
| `addresses` | Customer addresses |
| `assignments` | Order-partner assignments |
| `attendance` | Partner attendance |
| `reviews` | Customer reviews |
| `payments` | Razorpay/COD payments |
| `announcements` | Admin announcements |

---

## Step 7: Update All Database Queries

**CRITICAL:** Every SQL query in routes must be converted to MongoDB:

### PostgreSQL Example:
```javascript
const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
```

### MongoDB Equivalent:
```javascript
const user = await User.findOne({ phone });
```

### Files needing updates:
- `routes/customers.ts`
- `routes/orders.ts`
- `routes/chat.ts`
- `routes/staff.ts`
- `routes/general.ts`
- `routes/extras.ts`
- `otp.ts`
- `serviceArea.ts`
- `cash.ts`
- `dutyService.ts`
- `invoice.ts`
- `notify.ts`
- `partnerState.ts`
- `realtime.ts`
- `services.ts`
- `slots.ts`
- `sms.ts`

---

## Step 8: Data Migration (Optional - if you have existing data)

Export from PostgreSQL and import to MongoDB:
- Use `pg_dump` to export existing data
- Convert to JSON format
- Import using MongoDB Compass or `mongoimport`

---

## Step 9: Test Environment

1. Set `NODE_ENV=test` temporarily
2. Run tests to identify broken queries
3. Fix all MongoDB-related errors

---

## Step 10: Deploy to Render

1. Commit all changes
2. Push to git
3. Render will auto-redeploy

---

## Support

For issues during migration:
1. Check MongoDB Atlas logs
2. Verify connection string
3. Check network access whitelist
4. Ensure all environment variables are set

---

## Quick Start Commands

```bash
# 1. Create .env file
cp backend/.env.example backend/.env

# 2. Edit .env with MongoDB URI
nano backend/.env

# 3. Install mongoose
cd backend
npm install mongoose

# 4. Test database connection
npm run dev

# 5. Check logs for "MongoDB connected successfully"
```