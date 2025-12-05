#!/bin/bash

# Script to generate TypeScript code from Protocol Buffer definitions
# using ts-proto plugin with RxJS Observable support

# Exit on error
set -e

# Directories
PROTO_DIR="../../proto"
OUT_DIR="../src/generated"

# Create output directory if it doesn't exist
mkdir -p "$OUT_DIR"

# Generate TypeScript code with ts-proto
# --ts_proto_opt=returnObservable=true ensures service methods return RxJS Observables
protoc \
  --plugin=../../node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=returnObservable=true \
  --ts_proto_opt=esModuleInterop=true \
  --ts_proto_opt=outputServices=generic-definitions \
  --proto_path="$PROTO_DIR" \
  "$PROTO_DIR"/*.proto

echo "TypeScript code generation completed successfully!"
echo "Generated files are in: $OUT_DIR"
