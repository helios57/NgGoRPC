import { GrpcError, GrpcStatus } from './errors';

describe('GrpcError', () => {
  it('should create error with code and message', () => {
    const error = new GrpcError(GrpcStatus.NOT_FOUND, 'Resource not found');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GrpcError);
    expect(error.code).toBe(GrpcStatus.NOT_FOUND);
    expect(error.message).toBe('Resource not found');
    expect(error.name).toBe('GrpcError');
  });

  it('should create error with code and default message', () => {
    const error = new GrpcError(GrpcStatus.CANCELLED);

    expect(error.code).toBe(GrpcStatus.CANCELLED);
    expect(error.message).toBe('CANCELLED');
    expect(error.name).toBe('GrpcError');
  });

  it('should handle UNAVAILABLE status', () => {
    const error = new GrpcError(GrpcStatus.UNAVAILABLE, 'Connection lost');

    expect(error.code).toBe(GrpcStatus.UNAVAILABLE);
    expect(error.message).toBe('Connection lost');
  });

  it('should handle UNAUTHENTICATED status', () => {
    const error = new GrpcError(GrpcStatus.UNAUTHENTICATED, 'Invalid token');

    expect(error.code).toBe(GrpcStatus.UNAUTHENTICATED);
    expect(error.message).toBe('Invalid token');
  });

  it('should handle DEADLINE_EXCEEDED status', () => {
    const error = new GrpcError(GrpcStatus.DEADLINE_EXCEEDED, 'Timeout');

    expect(error.code).toBe(GrpcStatus.DEADLINE_EXCEEDED);
    expect(error.message).toBe('Timeout');
  });

  it('should be catchable as Error', () => {
    const throwError = () => {
      throw new GrpcError(GrpcStatus.INTERNAL, 'Server error');
    };

    try {
      throwError();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(GrpcError);
      if (e instanceof GrpcError) {
        expect(e.code).toBe(GrpcStatus.INTERNAL);
        expect(e.message).toBe('Server error');
      }
    }
  });
});

describe('GrpcStatus', () => {
  it('should have correct status code values', () => {
    expect(GrpcStatus.OK).toBe(0);
    expect(GrpcStatus.CANCELLED).toBe(1);
    expect(GrpcStatus.UNKNOWN).toBe(2);
    expect(GrpcStatus.INVALID_ARGUMENT).toBe(3);
    expect(GrpcStatus.DEADLINE_EXCEEDED).toBe(4);
    expect(GrpcStatus.NOT_FOUND).toBe(5);
    expect(GrpcStatus.ALREADY_EXISTS).toBe(6);
    expect(GrpcStatus.PERMISSION_DENIED).toBe(7);
    expect(GrpcStatus.RESOURCE_EXHAUSTED).toBe(8);
    expect(GrpcStatus.FAILED_PRECONDITION).toBe(9);
    expect(GrpcStatus.ABORTED).toBe(10);
    expect(GrpcStatus.OUT_OF_RANGE).toBe(11);
    expect(GrpcStatus.UNIMPLEMENTED).toBe(12);
    expect(GrpcStatus.INTERNAL).toBe(13);
    expect(GrpcStatus.UNAVAILABLE).toBe(14);
    expect(GrpcStatus.DATA_LOSS).toBe(15);
    expect(GrpcStatus.UNAUTHENTICATED).toBe(16);
  });

  it('should allow comparison with numeric values', () => {
    const errorCode = 5;
    expect(errorCode).toBe(GrpcStatus.NOT_FOUND);
  });

  it('should be usable in switch statements', () => {
    function handleStatus(code: GrpcStatus): string {
      switch (code) {
        case GrpcStatus.OK:
          return 'success';
        case GrpcStatus.PERMISSION_DENIED:
          return 'access denied';
        default:
          return 'other';
      }
    }

    expect(handleStatus(GrpcStatus.PERMISSION_DENIED)).toBe('access denied');
    expect(handleStatus(GrpcStatus.OK)).toBe('success');
    expect(handleStatus(GrpcStatus.NOT_FOUND)).toBe('other');
  });
});
