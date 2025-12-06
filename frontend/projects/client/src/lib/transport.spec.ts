import { of, throwError } from 'rxjs';
import { WebSocketRpcTransport, ServiceDefinition, MethodDescriptor } from './transport';
import { NgGoRpcClient } from './client';

// Mock message types for testing
interface TestRequest {
  name: string;
}

interface TestResponse {
  message: string;
}

interface TestTick {
  count: number;
  timestamp: number;
}

// Mock MessageFns
const mockRequestType = {
  encode: jest.fn((message: TestRequest) => ({
    finish: jest.fn(() => new Uint8Array([1, 2, 3]))
  })),
  decode: jest.fn(),
  fromJSON: jest.fn(),
  toJSON: jest.fn(),
  create: jest.fn((base?: any) => ({ name: '' })),
  fromPartial: jest.fn(),
};

const mockResponseType = {
  encode: jest.fn(),
  decode: jest.fn((input: Uint8Array) => ({ message: 'Hello, World!' })),
  fromJSON: jest.fn(),
  toJSON: jest.fn(),
  create: jest.fn(),
  fromPartial: jest.fn(),
};

const mockTickType = {
  encode: jest.fn(),
  decode: jest.fn((input: Uint8Array) => ({ count: 1, timestamp: 1000 })),
  fromJSON: jest.fn(),
  toJSON: jest.fn(),
  create: jest.fn(() => ({})),
  fromPartial: jest.fn(),
};

// Mock service definition
const mockServiceDef: ServiceDefinition = {
  name: 'TestService',
  fullName: 'test.TestService',
  methods: {
    sayHello: {
      name: 'SayHello',
      requestType: mockRequestType,
      requestStream: false,
      responseType: mockResponseType,
      responseStream: false,
      options: {},
    } as MethodDescriptor<TestRequest, TestResponse>,
    infiniteTicker: {
      name: 'InfiniteTicker',
      requestType: mockTickType,
      requestStream: false,
      responseType: mockTickType,
      responseStream: true,
      options: {},
    } as MethodDescriptor<TestTick, TestTick>,
  }
};

describe('WebSocketRpcTransport', () => {
  let mockClient: jest.Mocked<NgGoRpcClient>;
  let transport: WebSocketRpcTransport;

  beforeEach(() => {
    // Create a mock NgGoRpcClient
    mockClient = {
      request: jest.fn(),
    } as any;

    transport = new WebSocketRpcTransport(mockClient);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should create instance', () => {
    expect(transport).toBeTruthy();
  });

  describe('request (typed API)', () => {
    it('should encode request, call client, and decode response', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockResponseType.decode.mockReturnValue(decodedResponse);
      mockClient.request.mockReturnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods.sayHello,
        requestData
      ).subscribe({
        next: (response) => {
          expect(mockRequestType.encode).toHaveBeenCalledWith(requestData);
          expect(mockClient.request).toHaveBeenCalledWith(
            'test.TestService',
            'SayHello',
            encodedRequest
          );
          expect(mockResponseType.decode).toHaveBeenCalledWith(encodedResponse);
          expect(response).toEqual(decodedResponse);
          done();
        },
        error: (err) => done(err),
      });
    });

    it('should handle empty request data', (done) => {
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      mockRequestType.create.mockReturnValue({ name: '' });
      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockResponseType.decode.mockReturnValue(decodedResponse);
      mockClient.request.mockReturnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods.sayHello
      ).subscribe({
        next: (response) => {
          expect(mockRequestType.create).toHaveBeenCalledWith({});
          expect(response).toEqual(decodedResponse);
          done();
        },
        error: (err) => done(err),
      });
    });

    it('should pass through errors from client', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const error = new Error('Connection failed');

      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockClient.request.mockReturnValue(throwError(() => error));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods.sayHello,
        requestData
      ).subscribe({
        next: () => done(new Error('Should not emit value')),
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });

    it('should handle streaming responses', (done) => {
      const encodedRequest = new Uint8Array([0]);
      const encodedResponse1 = new Uint8Array([1]);
      const encodedResponse2 = new Uint8Array([2]);
      const decodedResponse1: TestTick = { count: 1, timestamp: 1000 };
      const decodedResponse2: TestTick = { count: 2, timestamp: 2000 };

      mockTickType.create.mockReturnValue({});
      mockTickType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockTickType.decode
        .mockReturnValueOnce(decodedResponse1)
        .mockReturnValueOnce(decodedResponse2);

      mockClient.request.mockReturnValue(
        new (require('rxjs').Observable)((subscriber: any) => {
          subscriber.next(encodedResponse1);
          subscriber.next(encodedResponse2);
          subscriber.complete();
        })
      );

      const responses: TestTick[] = [];
      transport.request(
        mockServiceDef,
        mockServiceDef.methods.infiniteTicker
      ).subscribe({
        next: (response) => {
          responses.push(response);
        },
        complete: () => {
          expect(responses).toHaveLength(2);
          expect(responses[0]).toEqual(decodedResponse1);
          expect(responses[1]).toEqual(decodedResponse2);
          done();
        },
        error: (err) => done(err),
      });
    });
  });

  describe('requestSignal', () => {
    it('should return a signal with the decoded response', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockResponseType.decode.mockReturnValue(decodedResponse);
      mockClient.request.mockReturnValue(of(encodedResponse));

      const signal = transport.requestSignal(
        mockServiceDef,
        mockServiceDef.methods.sayHello,
        requestData
      );

      // Signal should be defined
      expect(signal).toBeDefined();
      expect(typeof signal).toBe('function');

      // Wait a tick for the signal to update
      setTimeout(() => {
        const value = signal();
        expect(value).toEqual(decodedResponse);
        done();
      }, 10);
    });

    it('should work with empty request data', (done) => {
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      mockRequestType.create.mockReturnValue({ name: '' });
      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockResponseType.decode.mockReturnValue(decodedResponse);
      mockClient.request.mockReturnValue(of(encodedResponse));

      const signal = transport.requestSignal(
        mockServiceDef,
        mockServiceDef.methods.sayHello
      );

      expect(signal).toBeDefined();

      setTimeout(() => {
        const value = signal();
        expect(value).toEqual(decodedResponse);
        done();
      }, 10);
    });

    it('should work with ToSignalOptions', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };
      const initialValue: TestResponse = { message: 'Initial' };

      mockRequestType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockResponseType.decode.mockReturnValue(decodedResponse);

      // Use an async observable to test initialValue properly
      mockClient.request.mockReturnValue(
        new (require('rxjs').Observable)((subscriber: any) => {
          setTimeout(() => {
            subscriber.next(encodedResponse);
            subscriber.complete();
          }, 20);
        })
      );

      const signal = transport.requestSignal(
        mockServiceDef,
        mockServiceDef.methods.sayHello,
        requestData,
        { initialValue }
      );

      // Should have initial value immediately (before async observable emits)
      expect(signal()).toEqual(initialValue);

      setTimeout(() => {
        const value = signal();
        expect(value).toEqual(decodedResponse);
        done();
      }, 30);
    });

    it('should handle streaming responses as signals', (done) => {
      const encodedRequest = new Uint8Array([0]);
      const encodedResponse1 = new Uint8Array([1]);
      const encodedResponse2 = new Uint8Array([2]);
      const decodedResponse1: TestTick = { count: 1, timestamp: 1000 };
      const decodedResponse2: TestTick = { count: 2, timestamp: 2000 };

      mockTickType.create.mockReturnValue({});
      mockTickType.encode.mockReturnValue({
        finish: jest.fn(() => encodedRequest)
      });
      mockTickType.decode
        .mockReturnValueOnce(decodedResponse1)
        .mockReturnValueOnce(decodedResponse2);

      mockClient.request.mockReturnValue(
        new (require('rxjs').Observable)((subscriber: any) => {
          subscriber.next(encodedResponse1);
          setTimeout(() => {
            subscriber.next(encodedResponse2);
            subscriber.complete();
          }, 50);
        })
      );

      const signal = transport.requestSignal(
        mockServiceDef,
        mockServiceDef.methods.infiniteTicker
      );

      expect(signal).toBeDefined();

      // Check first value
      setTimeout(() => {
        const value1 = signal();
        expect(value1).toEqual(decodedResponse1);

        // Check second value
        setTimeout(() => {
          const value2 = signal();
          expect(value2).toEqual(decodedResponse2);
          done();
        }, 60);
      }, 10);
    });
  });
});
