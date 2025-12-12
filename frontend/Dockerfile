# Multi-stage Dockerfile for frontend

# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Cache buster: This ARG changes on every build to force rebuilding from here
ARG CACHE_BUST=1
RUN echo "Cache bust: $CACHE_BUST"

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]




