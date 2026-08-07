import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
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
  encode: jasmine.createSpy('encode').and.returnValue({
    finish: jasmine.createSpy('finish').and.returnValue(new Uint8Array([1, 2, 3]))
  }),
  decode: jasmine.createSpy('decode'),
  fromJSON: jasmine.createSpy('fromJSON'),
  toJSON: jasmine.createSpy('toJSON'),
  create: jasmine.createSpy('create').and.returnValue({ name: '' }),
  fromPartial: jasmine.createSpy('fromPartial'),
};

const mockResponseType = {
  encode: jasmine.createSpy('encode'),
  decode: jasmine.createSpy('decode').and.returnValue({ message: 'Hello, World!' }),
  fromJSON: jasmine.createSpy('fromJSON'),
  toJSON: jasmine.createSpy('toJSON'),
  create: jasmine.createSpy('create'),
  fromPartial: jasmine.createSpy('fromPartial'),
};

const mockTickType = {
  encode: jasmine.createSpy('encode'),
  decode: jasmine.createSpy('decode').and.returnValue({ count: 1, timestamp: 1000 }),
  fromJSON: jasmine.createSpy('fromJSON'),
  toJSON: jasmine.createSpy('toJSON'),
  create: jasmine.createSpy('create').and.returnValue({}),
  fromPartial: jasmine.createSpy('fromPartial'),
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
    uploadThings: {
      name: 'UploadThings',
      requestType: mockRequestType,
      requestStream: true,
      responseType: mockResponseType,
      responseStream: false,
      options: {},
    } as MethodDescriptor<TestRequest, TestResponse>,
  }
};

describe('WebSocketRpcTransport', () => {
  let mockClient: jasmine.SpyObj<NgGoRpcClient>;
  let transport: WebSocketRpcTransport;

  beforeEach(() => {
    mockClient = jasmine.createSpyObj('NgGoRpcClient', ['request', 'requestClientStream']);
    transport = new WebSocketRpcTransport(mockClient);
    // The mock message types are module-level singletons, so their spies keep
    // counting across specs. Without this reset a toHaveBeenCalledTimes()
    // assertion measures the whole file and its number depends on spec order.
    [mockRequestType, mockResponseType, mockTickType].forEach((type) => {
      Object.values(type).forEach((spy) => (spy as jasmine.Spy).calls.reset());
    });
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

      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
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
        }
      });
    });
  });

  describe('clientStream (typed API)', () => {
    it('should encode EVERY message and pass them to requestClientStream in order', (done) => {
      const messages: TestRequest[] = [{ name: 'header' }, { name: 'chunk-1' }, { name: 'chunk-2' }];
      const encodedResponse = new Uint8Array([9, 9, 9]);
      const decodedResponse: TestResponse = { message: 'stored' };

      // A distinct encoding per message, so a transport that only sent the first
      // one (the defect this API exists to fix) cannot pass this test.
      (mockRequestType.encode as jasmine.Spy).and.callFake((m: TestRequest) => ({
        finish: () => new TextEncoder().encode(m.name),
      }));
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.requestClientStream.and.returnValue(of(encodedResponse));

      transport.clientStream(
        mockServiceDef,
        mockServiceDef.methods['uploadThings'],
        messages,
        { authorization: 'Bearer t' }
      ).subscribe({
        next: (response) => {
          expect(mockRequestType.encode).toHaveBeenCalledTimes(3);
          const args = mockClient.requestClientStream.calls.mostRecent().args;
          expect(args[0]).toBe('test.TestService');
          expect(args[1]).toBe('UploadThings');
          const sent = args[2] as Uint8Array[];
          expect(sent.length).toBe(3);
          expect(new TextDecoder().decode(sent[0])).toBe('header');
          expect(new TextDecoder().decode(sent[1])).toBe('chunk-1');
          expect(new TextDecoder().decode(sent[2])).toBe('chunk-2');
          expect(args[3]).toEqual({ authorization: 'Bearer t' });
          expect(response).toEqual(decodedResponse);
          done();
        },
        error: done.fail,
      });
    });

    it('should REFUSE a unary method — the mirror of the request() guard', () => {
      expect(() => transport.clientStream(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
        [{ name: 'World' }]
      )).toThrowError(/is not client-streaming/);
      expect(mockClient.requestClientStream).not.toHaveBeenCalled();
    });
  });

  describe('request() refuses a client-streaming method', () => {
    // Calibration: this is exactly the call that used to succeed and produce a
    // one-message half-closed stream the server rejected at the application
    // layer. If this stops throwing, the original defect is reachable again.
    it('should throw rather than send one DATA|EOS frame', () => {
      expect(() => transport.request(
        mockServiceDef,
        mockServiceDef.methods['uploadThings'],
        { name: 'header-only' }
      )).toThrowError(/is client-streaming: use clientStream\(\)/);
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('should still send a unary method normally (negative control)', (done) => {
      (mockRequestType.encode as jasmine.Spy).and.returnValue({ finish: () => new Uint8Array([1]) });
      (mockResponseType.decode as jasmine.Spy).and.returnValue({ message: 'ok' });
      mockClient.request.and.returnValue(of(new Uint8Array([2])));
      transport.request(mockServiceDef, mockServiceDef.methods['sayHello'], { name: 'World' })
        .subscribe({
          next: () => {
            expect(mockClient.request).toHaveBeenCalled();
            done();
          },
          error: done.fail,
        });
    });
  });

  describe('requestSignal', () => {
    it('should return a signal with the decoded response', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      TestBed.runInInjectionContext(() => {
        const signal = transport.requestSignal(
          mockServiceDef,
          mockServiceDef.methods['sayHello'],
          requestData
        );

        expect(signal).toBeDefined();
        // of() emits synchronously, so signal should have value immediately
        setTimeout(() => {
          expect(signal()).toEqual(decodedResponse);
          done();
        }, 0);
      });
    });
  });

  describe('metadata support', () => {
    it('should pass metadata to client.request', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };
      const metadata = { 'x-request-id': 'test-123', 'authorization': 'Bearer token' };

      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
        requestData,
        metadata
      ).subscribe({
        next: (response) => {
          expect(mockClient.request).toHaveBeenCalledWith(
            'test.TestService',
            'SayHello',
            encodedRequest,
            metadata
          );
          expect(response).toEqual(decodedResponse);
          done();
        }
      });
    });

    it('should work without metadata parameter', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
        requestData
      ).subscribe({
        next: (response) => {
          expect(mockClient.request).toHaveBeenCalledWith(
            'test.TestService',
            'SayHello',
            encodedRequest
          );
          expect(response).toEqual(decodedResponse);
          done();
        }
      });
    });

    it('should handle empty metadata object', (done) => {
      const requestData: TestRequest = { name: 'World' };
      const encodedRequest = new Uint8Array([1, 2, 3]);
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };
      const metadata = {};

      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
        requestData,
        metadata
      ).subscribe({
        next: (response) => {
          expect(mockClient.request).toHaveBeenCalledWith(
            'test.TestService',
            'SayHello',
            encodedRequest,
            metadata
          );
          expect(response).toEqual(decodedResponse);
          done();
        }
      });
    });
  });

  describe('optional data', () => {
    it('should create empty message when data is undefined', (done) => {
      const encodedRequest = new Uint8Array([0]); // Empty message
      const encodedResponse = new Uint8Array([4, 5, 6]);
      const decodedResponse: TestResponse = { message: 'Hello, World!' };

      (mockRequestType.create as jasmine.Spy).and.returnValue({});
      (mockRequestType.encode as jasmine.Spy).and.returnValue({
        finish: () => encodedRequest
      });
      (mockResponseType.decode as jasmine.Spy).and.returnValue(decodedResponse);
      mockClient.request.and.returnValue(of(encodedResponse));

      transport.request(
        mockServiceDef,
        mockServiceDef.methods['sayHello'],
        undefined
      ).subscribe({
        next: (response) => {
          expect(mockRequestType.create).toHaveBeenCalled();
          expect(mockRequestType.encode).toHaveBeenCalledWith({});
          expect(mockClient.request).toHaveBeenCalledWith(
            'test.TestService',
            'SayHello',
            encodedRequest
          );
          expect(response).toEqual(decodedResponse);
          done();
        }
      });
    });
  });
});
