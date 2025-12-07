import { of } from 'rxjs';
import { fakeAsync, tick, TestBed } from '@angular/core/testing';
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
  }
};

describe('WebSocketRpcTransport', () => {
  let mockClient: jasmine.SpyObj<NgGoRpcClient>;
  let transport: WebSocketRpcTransport;

  beforeEach(() => {
    mockClient = jasmine.createSpyObj('NgGoRpcClient', ['request']);
    transport = new WebSocketRpcTransport(mockClient);
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

  describe('requestSignal', () => {
    it('should return a signal with the decoded response', fakeAsync(() => {
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
        tick();
        expect(signal()).toEqual(decodedResponse);
      });
    }));
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
});
