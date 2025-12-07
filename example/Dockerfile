# Multi-stage build for Go backend
# Stage 1: Build the Go binary
FROM golang:1.25-alpine AS builder

WORKDIR /build

# Copy entire project structure to preserve go.mod replace directives
COPY . .

# Change to example/server directory
WORKDIR /build/example/server

# Download dependencies
RUN go mod download

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server .

# Stage 2: Create minimal runtime image
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /build/example/server/server .

# Expose port
EXPOSE 8080

# Run the server
CMD ["./server"]
