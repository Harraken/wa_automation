# Quick Start Guide

Get your WhatsApp Provisioner running in 5 minutes!

## Prerequisites
- Docker & Docker Compose installed
- SMS-MAN account with API token
- 4GB+ RAM available

## Step-by-Step Setup

### 1. Clone and Configure

```bash
# Clone repository
git clone https://github.com/yourusername/wa-provisioner-ui.git
cd wa-provisioner-ui

# Copy environment file
cp env.example .env

# Edit .env and add your SMS-MAN token
nano .env  # or use your favorite editor
```

### 2. Required Environment Variables

Edit `.env` and set:
```env
SMSMAN_TOKEN=your_actual_token_here
JWT_SECRET=generate_random_string_here
AGENT_AUTH_SECRET=generate_another_random_string_here
```

💡 **Get SMS-MAN Token**: https://sms-man.com/ → API Settings

### 3. Start Services

```bash
# Start all services (first time build will take 5-10 minutes)
docker-compose up -d

# Wait for services to be ready
docker-compose logs -f api

# When you see "Server started" and "Database connected", press Ctrl+C
```

### 4. Initialize Database

```bash
# Run migrations
docker-compose exec api npm run prisma:migrate

# This creates all necessary tables
```

### 5. Create Admin User

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourSecurePassword123"}'
```

### 6. Access the Application

Open your browser:
- **Frontend**: http://localhost:5173
- **Login** with: `admin` / `YourSecurePassword123`

### 7. Provision Your First Session

1. Click **"+ New"** button
2. (Optional) Add a label like "Test Bot"
3. Click **"Start Provisioning"**
4. Wait 2-3 minutes (you'll see status updates)
5. Session will appear in sidebar when ready!

## What Happens During Provisioning?

```
1. System buys number from SMS-MAN (Germany)
2. Spawns Docker container with Android emulator
3. Launches WhatsApp in emulator
4. Enters phone number automatically
5. Waits for SMS OTP from SMS-MAN
6. Injects OTP into WhatsApp
7. Completes registration
8. Session is ACTIVE ✓
```

## View Your Session

- **Stream**: Click session → "Stream View" tab (see emulator screen)
- **Messages**: Click "Messages" tab to send/receive

## Send a Message

```bash
# Get your token first
TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourSecurePassword123"}' \
  | jq -r '.token')

# List sessions to get session_id
curl http://localhost:3000/sessions \
  -H "Authorization: Bearer $TOKEN"

# Send message
curl -X POST http://localhost:3000/sessions/YOUR_SESSION_ID/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+491234567890",
    "text": "Hello from automated WhatsApp!"
  }'
```

## Troubleshooting

### "SMSMAN_TOKEN is required"
- Make sure you saved `.env` with your actual token
- Restart services: `docker-compose restart`

### Container won't spawn
```bash
# Check Docker permissions
sudo chmod 666 /var/run/docker.sock

# Or add user to docker group
sudo usermod -aG docker $USER
```

### OTP timeout
- Normal during peak hours
- Check SMS-MAN balance
- Wait and try again

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker

# Emulator logs (replace SESSION_ID)
docker logs -f wa-session-SESSION_ID
```

## Stop Services

```bash
# Stop all
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v
```

## Next Steps

- Read full [README.md](README.md) for detailed docs
- Check [API Documentation](README.md#api-documentation)
- Import [Postman Collection](postman_collection.json)
- Set up monitoring with Prometheus

## Need Help?

- [Full Documentation](README.md)
- [Troubleshooting Guide](README.md#troubleshooting)
- [Open an Issue](https://github.com/yourusername/wa-provisioner-ui/issues)

---

**Happy automating! 🎉**






