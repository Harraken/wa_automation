# Multi-stage Dockerfile for backend

# Base stage
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Dependencies stage
FROM base AS dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Build stage
FROM base AS build
RUN npm ci

# Cache buster: This ARG changes on every build to force rebuilding from here
ARG CACHE_BUST=1
RUN echo "Cache bust: $CACHE_BUST"

COPY src ./src
RUN npm run build && \
    npx prisma generate

# API stage
FROM node:18-alpine AS api
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package*.json ./
COPY prisma ./prisma/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]

# Worker stage
FROM node:18-alpine AS worker
# Install Chromium for Puppeteer + openssl
RUN apk add --no-cache \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package*.json ./
COPY prisma ./prisma/

ENV NODE_ENV=production
# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

CMD ["node", "dist/worker.js"]



