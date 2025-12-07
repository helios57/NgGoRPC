# Multi-stage build for Angular workspace
FROM node:24-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm i

# Copy source code
COPY frontend/ ./

# Build the library first
RUN npm run build:lib

# Build the demo application
RUN npm run build -- --configuration production

# Production stage with nginx
FROM nginx:alpine

# Copy built application from builder stage
COPY --from=builder /app/dist/demo-app/browser/ /usr/share/nginx/html/

# Copy custom nginx configuration
COPY demo-app/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
