#!/bin/bash

# Script to generate Go code from Protocol Buffer definitions
# using protoc-gen-go and protoc-gen-go-grpc plugins

# Exit on error
set -e

# Directories
PROTO_DIR="../../proto"
OUT_DIR="../generated"

# Create output directory if it doesn't exist
mkdir -p "$OUT_DIR"

# Generate Go code with protoc
# --go_out generates protobuf message code
# --go-grpc_out generates gRPC service interfaces (GreeterServer, RegisterGreeterServer)
protoc \
  --go_out="$OUT_DIR" \
  --go_opt=paths=source_relative \
  --go-grpc_out="$OUT_DIR" \
  --go-grpc_opt=paths=source_relative \
  --proto_path="$PROTO_DIR" \
  "$PROTO_DIR"/*.proto

echo "Go code generation completed successfully!"
echo "Generated files are in: $OUT_DIR"
