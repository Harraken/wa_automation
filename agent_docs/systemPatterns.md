# System Patterns

## Architecture Overview
Microservices architecture with:
- **API Server**: Express REST API with JWT auth
- **Worker Service**: BullMQ workers for async provisioning
- **Agent**: Node.js agent running inside each emulator container
- **Frontend**: React SPA with real-time updates
- **Infrastructure**: PostgreSQL, Redis, Docker containers

## Key Technical Decisions

### 1. Containerized Emulators
Each WhatsApp session runs in its own Docker container with:
- Android emulator (AVD)
- Appium server
- Node.js agent
- VNC server for streaming

**Why**: Isolation, scalability, snapshot capability

### 2. Job Queue Pattern
Provisioning flow is asynchronous via BullMQ:
- Long-running operations don't block API
- Retry logic built-in
- Progress tracking

**Why**: SMS polling can take 1-3 minutes; need robust retry

### 3. WebSocket Agent Communication
Each agent connects to backend via WebSocket:
- Backend pushes commands (injectOtp, sendMessage)
- Agent pushes events (activated, messageReceived)
- Short-lived tokens for security

**Why**: Real-time control needed; HTTP polling insufficient

### 4. Streaming via noVNC
- x11vnc exposes emulator screen
- websockify provides WebSocket tunnel
- Frontend embeds in iframe

**Why**: Browser-native, no plugin needed, proven solution

### 5. Optional WhatsApp Web Linking
If `linkToWeb=true`:
- Agent captures QR code screenshot
- OCR extracts QR data
- Playwright container spawns and scans
- DOM parsing provides rich message data

**Why**: Appium UI parsing fragile; Web DOM more reliable

## Data Flow
```
User clicks Provision
  ↓
API: POST /provision → DB: Create Provision → Queue: onboard:provision job
  ↓
Worker: Buy number from SMS-MAN → Spawn container → Start agent
  ↓
Agent: Launch WhatsApp → Enter number → Request OTP
  ↓
Worker: Poll SMS-MAN → Get OTP → Push to agent via WS
  ↓
Agent: Inject OTP → Complete setup → Notify activated
  ↓
Worker: Create Session → Snapshot profile → Mark active
  ↓
Frontend: Session appears in sidebar, stream becomes available
```

## Error Handling Strategy
- Exponential backoff for SMS-MAN polling
- Retry logic in BullMQ (3 attempts)
- State machine for provision status
- Agent health checks via WS ping/pong
- Cleanup jobs for abandoned containers



