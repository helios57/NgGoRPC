# @nggorpc/client

Angular client library for NgGoRPC - enabling gRPC over WebSocket communication.

## Overview

This library provides a WebSocket-based transport layer for gRPC communication in Angular applications. It enables:

- Full duplex multiplexing over a single WebSocket connection
- Bidirectional streaming support
- Angular Zone-optimized performance
- Seamless integration with `ts-proto` generated clients

## Installation

```bash
npm install @nggorpc/client
```

## Usage

```typescript
import { NgGoRpcClient, WebSocketRpcTransport } from '@nggorpc/client';
import { GreeterClient } from './generated/greeter';

// In your Angular service or component
constructor(private rpcClient: NgGoRpcClient) {
  this.rpcClient.connect('ws://localhost:8080/rpc');
  
  const transport = new WebSocketRpcTransport(this.rpcClient);
  const greeterClient = new GreeterClient(transport);
  
  greeterClient.sayHello({ name: 'World' }).subscribe(
    response => console.log(response.message),
    error => console.error('RPC failed:', error)
  );
}
```

## Development

### Build

```bash
npm run build
```

### Generate Protobuf Code

```bash
npm run protoc
```

### Clean Build Artifacts

```bash
npm run clean
```

## Publishing

To publish the library to a private npm registry:

1. **Configure Registry** (if using a private registry):
   ```bash
   npm config set registry https://your-private-registry.com/
   # or use .npmrc file
   ```

2. **Login to Registry**:
   ```bash
   npm login
   ```

3. **Publish**:
   ```bash
   npm publish --access restricted
   ```
   
   The `prepublishOnly` script will automatically clean and rebuild the package before publishing.

4. **Versioning**:
   ```bash
   npm version patch  # for bug fixes
   npm version minor  # for new features
   npm version major  # for breaking changes
   npm publish --access restricted
   ```

## License

MIT
