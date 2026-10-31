# MongoDB Deployment Checklist - Kamal Medical Hall

## ✅ Pre-Deployment Checklist

### 1. MongoDB Atlas Setup
- [ ] MongoDB Atlas account created
- [ ] Cluster configured in Mumbai (ap-south-1) region
- [ ] Database user created (`kamal_user`)
- [ ] IP Whitelist configured (Your Render server IP or 0.0.0.0/0 for dev)
- [ ] Connection string obtained

### 2. Environment Variables on Render
Set these Environment Variables in Render Dashboard:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://kamal_user:your_password@kamal-medical-hall.mongodb.io/kamal-medical-hall?retryWrites=true&w=majority` |
| `NODE_ENV` | `production` |
| `AUTH_MODE` | `dev` |
| `JWT_SECRET` | `your-32-character-secret` |
| `PUBLIC_URL` | `https://api.kamalmedicalhall.com` |
| `CORS_ORIGINS` | `https://www.kamalmedicalhall.com` |
| `PORT` | `4000` |

### 3. Run Migration Script
```bash
# Locally to test (optional)
cd backend
npx tsx migrate-to-mongodb.ts
```

### 4. Deploy
- Push commits to trigger Render auto-deploy
- Monitor logs for "MongoDB connected successfully"

---

## ✅ Post-Deployment Testing

### 1. Health Check
```bash
curl https://api.kamalmedicalhall.com/health
# Should return: {"ok":true}
```

### 2. Authentication Test
```bash
# Dev login with OTP 123456
curl -X POST https://api.kamalmedicalhall.com/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"phone":"9000000001","otp":"123456"}'
```

### 3. Config Endpoint
```bash
curl https://api.kamalmedicalhall.com/config
# Should return API configuration
```

---

## ✅ Mobile App Configuration

In `mobile/.env`:
```bash
EXPO_PUBLIC_API_URL=https://api.kamalmedicalhall.com
EXPO_PUBLIC_AUTH_MODE=dev
EXPO_PUBLIC_API_TRANSPORT=http
```

---

## ✅ Troubleshooting

### MongoDB Connection Failed
1. Check MONGODB_URI format
2. Verify IP whitelist in Atlas
3. Check MongoDB cluster status (should be "Running")

### Authentication Issues
1. Verify JWT_SECRET is 32+ characters
2. Set AUTH_MODE=dev for testing
3. Check bootstrap phone numbers

### CORS Errors
1. Verify CORS_ORIGINS matches your app domain
2. Ensure no trailing slashes
3. Check browser console for specific errors

---

## 📞 Support

If issues persist:
1. Check Render logs: Dashboard → Logs
2. Check MongoDB logs: Atlas → Insights → Logs
3. Verify network connectivity between Render and MongoDB