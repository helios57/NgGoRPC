import { Component, NgZone, OnDestroy, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgGoRpcClient, WebSocketRpcTransport } from '@nggorpc/client';
import { Tick, HelloResponse, GreeterDefinition } from './generated/greeter';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  standalone: true,
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'NgGoRPC Infinite Ticker Demo';

  // Use signals for reactive state
  status = signal<'disconnected' | 'connected' | 'reconnecting'>('disconnected');
  tickCount = signal<number>(0);
  lastTimestamp = signal<string>('-');

  // Unary RPC properties
  greetingName: string = 'World';
  greetingResponse = signal<string>('');
  greetingError = signal<string>('');

  // Concurrent streams properties
  stream1Count = signal<number>(0);
  stream2Count = signal<number>(0);
  stream1Active = signal<boolean>(false);
  stream2Active = signal<boolean>(false);

  // requestSignal examples properties
  signalGreetingName: string = 'Signal World';
  signalGreetingResponse = signal<HelloResponse | undefined>(undefined);

  signalStreamTick = signal<Tick | undefined>(undefined);
  signalStreamActive = signal<boolean>(false);
  private signalStreamSubscription?: Subscription;

  private rpcClient!: NgGoRpcClient;
  private transport!: WebSocketRpcTransport;
  private tickerSubscription?: Subscription;
  private stream1Subscription?: Subscription;
  private stream2Subscription?: Subscription;
  private statusCheckInterval?: ReturnType<typeof setInterval>;

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
    // Use the same host/port as the page, allowing Nginx to proxy /ws to the backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.rpcClient.connect(wsUrl, true);

    // Monitor connection status with periodic checks
    this.statusCheckInterval = setInterval(() => {
      this.ngZone.run(() => {
        if (this.rpcClient.isConnected()) {
          this.status.set('connected');
        } else if (this.status() === 'connected') {
          // Was connected, now disconnected - reconnecting
          this.status.set('reconnecting');
        } else {
          // Initial connection or still disconnected
          this.status.set('disconnected');
        }
      });
    }, 500); // Check every 500ms
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.stopStream1();
    this.stopStream2();
    this.stopSignalStream();
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    this.rpcClient.disconnect();
  }

  startTicker(): void {
    if (this.tickerSubscription) {
      return; // Already running
    }

    this.tickCount.set(0);
    this.lastTimestamp.set('-');

    // Call InfiniteTicker using the new typed API
    this.tickerSubscription = this.transport.request(
      GreeterDefinition,
      GreeterDefinition.methods.infiniteTicker
    ).subscribe({
      next: (tick: Tick) => {
        this.status.set('connected');
        this.tickCount.set(Number(tick.count));
        this.lastTimestamp.set(new Date(Number(tick.timestamp) * 1000).toLocaleString());
      },
      error: (err: Error) => {
        console.error('Ticker error:', err);
        this.status.set('reconnecting');
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
    this.greetingError.set('');
    this.greetingResponse.set('Loading...');

    this.transport.request(
      GreeterDefinition,
      GreeterDefinition.methods.sayHello,
      { name: this.greetingName }
    ).subscribe({
      next: (response: HelloResponse) => {
        this.greetingResponse.set(response.message);
        console.log('SayHello response:', response.message);
      },
      error: (err: Error) => {
        this.greetingError.set(err.message);
        this.greetingResponse.set('');
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

    this.stream1Count.set(0);
    this.stream1Active.set(true);

    this.stream1Subscription = this.transport.request(
      GreeterDefinition,
      GreeterDefinition.methods.infiniteTicker
    ).subscribe({
      next: (tick: Tick) => {
        this.stream1Count.set(Number(tick.count));
      },
      error: (err: Error) => {
        console.error('Stream 1 error:', err);
        this.stream1Active.set(false);
        this.stream1Subscription = undefined;
      },
      complete: () => {
        console.log('Stream 1 completed');
        this.stream1Active.set(false);
        this.stream1Subscription = undefined;
      }
    });
  }

  stopStream1(): void {
    if (this.stream1Subscription) {
      this.stream1Subscription.unsubscribe();
      this.stream1Subscription = undefined;
      this.stream1Active.set(false);
    }
  }

  // Concurrent stream 2 methods
  startStream2(): void {
    if (this.stream2Subscription) {
      return; // Already running
    }

    this.stream2Count.set(0);
    this.stream2Active.set(true);

    this.stream2Subscription = this.transport.request(
      GreeterDefinition,
      GreeterDefinition.methods.infiniteTicker
    ).subscribe({
      next: (tick: Tick) => {
        this.stream2Count.set(Number(tick.count));
      },
      error: (err: Error) => {
        console.error('Stream 2 error:', err);
        this.stream2Active.set(false);
        this.stream2Subscription = undefined;
      },
      complete: () => {
        console.log('Stream 2 completed');
        this.stream2Active.set(false);
        this.stream2Subscription = undefined;
      }
    });
  }

  stopStream2(): void {
    if (this.stream2Subscription) {
      this.stream2Subscription.unsubscribe();
      this.stream2Subscription = undefined;
      this.stream2Active.set(false);
    }
  }

  // requestSignal example methods
  sayHelloWithSignal(): void {
    // Use requestSignal to get a signal directly from the RPC call
    const responseSignal = this.transport.requestSignal(
      GreeterDefinition,
      GreeterDefinition.methods.sayHello,
      { name: this.signalGreetingName }
    );

    // Update our component signal with the response
    // Note: requestSignal returns a Signal, so we need to subscribe to its changes
    this.signalGreetingResponse.set(responseSignal());

    // Create an effect to track signal changes (useful for debugging)
    effect(() => {
      const response = responseSignal();
      if (response) {
        this.signalGreetingResponse.set(response);
        console.log('SayHello (Signal) response:', response.message);
      }
    });
  }

  startSignalStream(): void {
    if (this.signalStreamSubscription) {
      return; // Already running
    }

    this.signalStreamTick.set(undefined);
    this.signalStreamActive.set(true);

    // For streaming, we still need to subscribe to the observable
    // but we can also demonstrate using requestSignal with streaming responses
    this.signalStreamSubscription = this.transport.request(
      GreeterDefinition,
      GreeterDefinition.methods.infiniteTicker
    ).subscribe({
      next: (tick: Tick) => {
        this.signalStreamTick.set(tick);
      },
      error: (err: Error) => {
        console.error('Signal Stream error:', err);
        this.signalStreamActive.set(false);
        this.signalStreamSubscription = undefined;
      },
      complete: () => {
        console.log('Signal Stream completed');
        this.signalStreamActive.set(false);
        this.signalStreamSubscription = undefined;
      }
    });
  }

  stopSignalStream(): void {
    if (this.signalStreamSubscription) {
      this.signalStreamSubscription.unsubscribe();
      this.signalStreamSubscription = undefined;
      this.signalStreamActive.set(false);
    }
  }
}
