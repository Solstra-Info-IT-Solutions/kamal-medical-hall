# MongoDB Atlas Setup Guide - Kamal Medical Hall

## 1. Create Atlas Account
- Go to: https://www.mongodb.com/cloud/atlas
- Sign up (free M0 tier available)

## 2. Create Cluster
```
Region: Mumbai (ap-south-1)
Cluster Tier: M0 (Free) or M10 (Production)
Database Name: kamal-medical-hall
```

## 3. Create Database User
- **Username:** kamal_user
- **Password:** [your-strong-password]
- **Privileges:** Read and write to any database

## 4. Get Connection String
From Atlas Dashboard → Clusters → Connect → URI:
```
mongodb+srv://kamal_user:<password>@kamal-medical-hall.mongodb.net/kamal-medical-hall?retryWrites=true&w=majority
```

## 5. Add IP to Database Access
In Atlas → Security → Network Access → IP Whitelist:
- Add your current IP (or 0.0.0.0/0 for development - remove in production)

## 6. Install Dependencies
```bash
cd backend
npm install mongoose
```

## 7. Create .env file
```bash
MONGODB_URI=mongodb+srv://kamal_user:password@kamal-medical-hall.mongodb.io/kamal-medical-hall?retryWrites=true&w=majority
JWT_SECRET=your-32-character-secret
AUTH_MODE=dev
```

## 8. Replace Database Layer
Replace `src/db.ts` with the MongoDB version provided.

## 9. Update All Routes
Run migration script to update all SQL queries.

## Need help? Contact your dev team.