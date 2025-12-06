import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgGoRpcClient, WebSocketRpcTransport } from '@nggorpc/client';
import { Empty, Tick } from './generated/greeter';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'NgGoRPC Infinite Ticker Demo';

  status: 'disconnected' | 'connected' | 'reconnecting' = 'disconnected';
  tickCount: number = 0;
  lastTimestamp: string = '-';

  private rpcClient!: NgGoRpcClient;
  private transport!: WebSocketRpcTransport;
  private tickerSubscription?: Subscription;
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

    // Connect with automatic reconnection
    const wsUrl = `ws://${window.location.hostname}:8080/ws`;
    this.rpcClient.connect(wsUrl, true);

    // Create transport
    this.transport = new WebSocketRpcTransport(this.rpcClient);

    // Monitor connection status with periodic checks
    this.statusCheckInterval = setInterval(() => {
      this.ngZone.run(() => {
        if (this.rpcClient.isConnected()) {
          this.status = 'connected';
        } else {
          this.status = 'reconnecting';
        }
      });
    }, 500); // Check every 500ms
  }

  ngOnDestroy(): void {
    this.stopTicker();
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
}
