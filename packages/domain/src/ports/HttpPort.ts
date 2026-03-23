export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpPort {
  request(req: HttpRequest): Promise<HttpResponse>;
}
