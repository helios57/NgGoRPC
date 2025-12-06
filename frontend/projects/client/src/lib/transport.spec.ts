import { of } from 'rxjs';
import { WebSocketRpcTransport } from './transport';
import { NgGoRpcClient } from './client';

describe('WebSocketRpcTransport', () => {
  let mockClient: jest.Mocked<NgGoRpcClient>;
  let transport: WebSocketRpcTransport;

  beforeEach(() => {
    // Create a mock NgGoRpcClient
    mockClient = {
      request: jest.fn(),
    } as any;

    transport = new WebSocketRpcTransport(mockClient);
  });

  it('should create instance', () => {
    expect(transport).toBeTruthy();
  });

  it('should delegate request to client', (done) => {
    const service = 'greeter.Greeter';
    const method = 'SayHello';
    const data = new Uint8Array([1, 2, 3]);
    const expectedResponse = new Uint8Array([4, 5, 6]);

    mockClient.request.mockReturnValue(of(expectedResponse));

    transport.request(service, method, data).subscribe({
      next: (response) => {
        expect(response).toBe(expectedResponse);
        expect(mockClient.request).toHaveBeenCalledWith(service, method, data);
        done();
      },
      error: (err) => done(err),
    });
  });

  it('should pass through errors from client', (done) => {
    const service = 'greeter.Greeter';
    const method = 'SayHello';
    const data = new Uint8Array([1, 2, 3]);
    const error = new Error('Connection failed');

    mockClient.request.mockReturnValue(
      new (require('rxjs').Observable)((subscriber: any) => {
        subscriber.error(error);
      })
    );

    transport.request(service, method, data).subscribe({
      next: () => done(new Error('Should not emit value')),
      error: (err) => {
        expect(err).toBe(error);
        done();
      },
    });
  });
});
