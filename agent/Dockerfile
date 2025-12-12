# Multi-stage Dockerfile for Android Emulator + Agent
# Based on budtmo/docker-android but with custom agent

FROM budtmo/docker-android:latest

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install x11vnc and websockify for streaming
RUN apt-get update && apt-get install -y \
    x11vnc \
    websockify \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create agent directory
WORKDIR /agent

# Copy agent code
COPY package.json tsconfig.json ./
COPY src ./src

# Install dependencies and build
RUN npm install && npm run build

# Create startup script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start Appium\n\
appium --address 0.0.0.0 --port 4723 &\n\
\n\
# Start VNC server\n\
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 &\n\
\n\
# Start websockify for noVNC\n\
websockify --web=/usr/share/novnc 6080 localhost:5900 &\n\
\n\
# Wait for emulator to be ready\n\
sleep 30\n\
\n\
# Start agent\n\
cd /agent\n\
node dist/index.js\n\
' > /start-agent.sh && chmod +x /start-agent.sh

EXPOSE 4723 5900 6080

CMD ["/start-agent.sh"]





