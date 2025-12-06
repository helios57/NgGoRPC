import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgGoRpcClient, WebSocketRpcTransport } from '@nggorpc/client';
import { Empty, Tick, HelloRequest, HelloResponse } from './generated/greeter';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'NgGoRPC Infinite Ticker Demo';

  status: 'disconnected' | 'connected' | 'reconnecting' = 'disconnected';
  tickCount: number = 0;
  lastTimestamp: string = '-';

  // Unary RPC properties
  greetingName: string = 'World';
  greetingResponse: string = '';
  greetingError: string = '';

  // Concurrent streams properties
  stream1Count: number = 0;
  stream2Count: number = 0;
  stream1Active: boolean = false;
  stream2Active: boolean = false;

  private rpcClient!: NgGoRpcClient;
  private transport!: WebSocketRpcTransport;
  private tickerSubscription?: Subscription;
  private stream1Subscription?: Subscription;
  private stream2Subscription?: Subscription;
  private statusSubscription?: Subscription;
  private statusCheckInterval?: any;

  constructor(private ngZone: NgZone) {}

  ngOnInit(): void {
    // Initialize RPC client
    this.rpcClient = new NgGoRpcClient(this.ngZone, {
      pingInterval: 30000,
      baseReconnectDelay: 2000,
      maxReconnectDelay: 30000,
      enableLogging: true
    });

    // Create transport
    this.transport = new WebSocketRpcTransport(this.rpcClient);

    // Connect with automatic reconnection
    const wsUrl = `ws://${window.location.hostname}:8080/ws`;
    this.rpcClient.connect(wsUrl, true);

    // Monitor connection status with periodic checks
    this.statusCheckInterval = setInterval(() => {
      this.ngZone.run(() => {
        if (this.rpcClient.isConnected()) {
          this.status = 'connected';
        } else if (this.status === 'connected') {
          // Was connected, now disconnected - reconnecting
          this.status = 'reconnecting';
        } else {
          // Initial connection or still disconnected
          this.status = 'disconnected';
        }
      });
    }, 500); // Check every 500ms
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.stopStream1();
    this.stopStream2();
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
    }
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    this.rpcClient.disconnect();
  }

  startTicker(): void {
    if (this.tickerSubscription) {
      return; // Already running
    }

    this.tickCount = 0;
    this.lastTimestamp = '-';

    // Encode empty request
    const requestData = Empty.encode({}).finish();

    // Call InfiniteTicker using the transport
    this.tickerSubscription = this.transport.request(
      'greeter.Greeter',
      'InfiniteTicker',
      requestData
    ).pipe(
      map((data: Uint8Array) => Tick.decode(data))
    ).subscribe({
      next: (tick: Tick) => {
        this.status = 'connected';
        this.tickCount = Number(tick.count);
        this.lastTimestamp = new Date(Number(tick.timestamp) * 1000).toLocaleString();
      },
      error: (err: Error) => {
        console.error('Ticker error:', err);
        this.status = 'reconnecting';
        this.tickerSubscription = undefined;
      },
      complete: () => {
        console.log('Ticker completed');
        this.tickerSubscription = undefined;
      }
    });
  }

  stopTicker(): void {
    if (this.tickerSubscription) {
      this.tickerSubscription.unsubscribe();
      this.tickerSubscription = undefined;
    }
  }

  get isTickerActive(): boolean {
    return !!this.tickerSubscription;
  }

  // Unary RPC method
  sayHello(): void {
    this.greetingError = '';
    this.greetingResponse = 'Loading...';

    const requestData = HelloRequest.encode({ name: this.greetingName }).finish();

    this.transport.request(
      'greeter.Greeter',
      'SayHello',
      requestData
    ).pipe(
      map((data: Uint8Array) => HelloResponse.decode(data))
    ).subscribe({
      next: (response: HelloResponse) => {
        this.greetingResponse = response.message;
        console.log('SayHello response:', response.message);
      },
      error: (err: Error) => {
        this.greetingError = err.message;
        this.greetingResponse = '';
        console.error('SayHello error:', err);
      },
      complete: () => {
        console.log('SayHello completed');
      }
    });
  }

  // Concurrent stream 1 methods
  startStream1(): void {
    if (this.stream1Subscription) {
      return; // Already running
    }

    this.stream1Count = 0;
    this.stream1Active = true;

    const requestData = Empty.encode({}).finish();

    this.stream1Subscription = this.transport.request(
      'greeter.Greeter',
      'InfiniteTicker',
      requestData
    ).pipe(
      map((data: Uint8Array) => Tick.decode(data))
    ).subscribe({
      next: (tick: Tick) => {
        this.stream1Count = Number(tick.count);
      },
      error: (err: Error) => {
        console.error('Stream 1 error:', err);
        this.stream1Active = false;
        this.stream1Subscription = undefined;
      },
      complete: () => {
        console.log('Stream 1 completed');
        this.stream1Active = false;
        this.stream1Subscription = undefined;
      }
    });
  }

  stopStream1(): void {
    if (this.stream1Subscription) {
      this.stream1Subscription.unsubscribe();
      this.stream1Subscription = undefined;
      this.stream1Active = false;
    }
  }

  // Concurrent stream 2 methods
  startStream2(): void {
    if (this.stream2Subscription) {
      return; // Already running
    }

    this.stream2Count = 0;
    this.stream2Active = true;

    const requestData = Empty.encode({}).finish();

    this.stream2Subscription = this.transport.request(
      'greeter.Greeter',
      'InfiniteTicker',
      requestData
    ).pipe(
      map((data: Uint8Array) => Tick.decode(data))
    ).subscribe({
      next: (tick: Tick) => {
        this.stream2Count = Number(tick.count);
      },
      error: (err: Error) => {
        console.error('Stream 2 error:', err);
        this.stream2Active = false;
        this.stream2Subscription = undefined;
      },
      complete: () => {
        console.log('Stream 2 completed');
        this.stream2Active = false;
        this.stream2Subscription = undefined;
      }
    });
  }

  stopStream2(): void {
    if (this.stream2Subscription) {
      this.stream2Subscription.unsubscribe();
      this.stream2Subscription = undefined;
      this.stream2Active = false;
    }
  }
}
