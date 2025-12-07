/** gRPC status codes aligned with google.golang.org/grpc/codes */
export enum GrpcStatus {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

/** Typed gRPC error surfaced to consumers */
export class GrpcError extends Error {
  constructor(public readonly code: GrpcStatus, message?: string) {
    super(message ?? GrpcStatus[code] ?? 'gRPC Error');
    this.name = 'GrpcError';
  }
}
