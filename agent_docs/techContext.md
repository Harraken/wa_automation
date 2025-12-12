# Technical Context

## Technologies Used

### Backend
- **Runtime**: Node.js v18+
- **Language**: TypeScript
- **Framework**: Express
- **HTTP Client**: Axios
- **Queue**: BullMQ (Redis-based)
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Auth**: JWT (jsonwebtoken)
- **WebSocket**: Socket.IO
- **Logging**: Pino
- **Metrics**: Prometheus (prom-client)
- **Testing**: Jest

### Emulator & Automation
- **Emulator**: budtmo/docker-android-x86-9.0 (or compatible)
- **Automation**: Appium WebDriver
- **Device Control**: ADB (Android Debug Bridge)
- **OCR**: Tesseract.js (for QR code reading)
- **Streaming**: x11vnc + websockify (noVNC)
- **Browser Automation**: Playwright (optional, for Web linking)

### Frontend
- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Real-time**: Socket.IO client
- **State Management**: React hooks + Context
- **HTTP Client**: Axios
- **Build Tool**: Vite

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Orchestration (optional)**: Kubernetes manifests
- **CI/CD**: GitHub Actions
- **Code Quality**: ESLint + Prettier

## Development Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- SMS-MAN account with API token

### Environment Variables
See `.env.example` for all required variables. Key ones:
- `SMSMAN_TOKEN`: Your SMS-MAN API token
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret for JWT signing
- `AGENT_AUTH_SECRET`: Secret for agent WS auth

### Local Development
```bash
# 1. Copy env file
cp .env.example .env
# Edit .env with real credentials

# 2. Start services
docker-compose up -d postgres redis

# 3. Run migrations
npm run prisma:migrate

# 4. Start backend
npm run dev

# 5. Start frontend (in separate terminal)
cd frontend && npm run dev
```

## Technical Constraints

### SMS-MAN API
- Rate limits: Unknown, implement backoff
- Polling interval: 4 seconds minimum (configurable)
- Timeout: 3 minutes default (configurable)
- Country ID for Germany: Auto-detected via API
- WhatsApp application_id: Auto-detected via API

### Emulator
- Requires KVM support for x86 images (hardware acceleration)
- Fallback to ARM images on macOS/Windows (slower)
- Each container ~2GB RAM minimum
- VNC port must be unique per container

### Appium
- Requires Android SDK tools in container
- WhatsApp APK must be pre-installed in emulator image
- UI selectors may break with WhatsApp updates (use robust locators)

### Security
- Never commit real API tokens
- Rotate agent WS tokens every session
- Rate limit provision endpoint
- Validate all SMS-MAN responses
- Sanitize all user inputs



