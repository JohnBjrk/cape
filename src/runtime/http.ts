// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/** Thrown by runtime.http convenience methods on non-2xx responses. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    /** Raw response body text. */
    public readonly body: string,
  ) {
    super(`HTTP ${status} ${statusText} — ${url}`);
    this.name = "HttpError";
  }
}

export interface HttpRequestOptions {
  /** Additional headers merged with defaults. */
  headers?: Record<string, string>;
}

export interface HttpInterface {
  /**
   * GET the URL and parse the response as JSON.
   * Throws HttpError on non-2xx.
   */
  get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T>;
  /**
   * POST the URL with a JSON-serialised body and parse the response as JSON.
   * Throws HttpError on non-2xx.
   */
  post<T = unknown>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>;
  /**
   * PUT the URL with a JSON-serialised body and parse the response as JSON.
   * Throws HttpError on non-2xx.
   */
  put<T = unknown>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>;
  /**
   * PATCH the URL with a JSON-serialised body and parse the response as JSON.
   * Throws HttpError on non-2xx.
   */
  patch<T = unknown>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>;
  /**
   * DELETE the URL and parse the response as JSON.
   * Throws HttpError on non-2xx.
   */
  delete<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T>;
  /**
   * Raw fetch — uses runtime.signal for cancellation but gives full control.
   * Unlike the convenience methods, does NOT throw on non-2xx.
   */
  fetch(url: string, init?: Omit<RequestInit, "signal">): Promise<Response>;
  /** The error class thrown on non-2xx responses. */
  HttpError: typeof HttpError;
}

export function createHttp(signal: AbortSignal): HttpInterface {
  function rawFetch(url: string, init: Omit<RequestInit, "signal">): Promise<Response> {
    return fetch(url, { ...init, signal });
  }

  async function jsonRequest<T>(
    method: string,
    url: string,
    body: unknown,
    opts: HttpRequestOptions | undefined,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...opts?.headers };
    let bodyPayload: string | undefined;

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(body);
    }

    const res = await rawFetch(url, { method, headers, body: bodyPayload });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, res.statusText, url, text);
    }

    // 204 No Content or empty body — return empty object
    const contentLength = res.headers.get("content-length");
    if (res.status === 204 || contentLength === "0") return {} as T;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return res.json() as Promise<T>;

    // Non-JSON 2xx — attempt parse, fall back to empty object
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  return {
    get:    (url, opts)        => jsonRequest("GET",    url, undefined, opts),
    post:   (url, body, opts)  => jsonRequest("POST",   url, body,      opts),
    put:    (url, body, opts)  => jsonRequest("PUT",    url, body,      opts),
    patch:  (url, body, opts)  => jsonRequest("PATCH",  url, body,      opts),
    delete: (url, opts)        => jsonRequest("DELETE", url, undefined, opts),
    fetch:  rawFetch,
    HttpError,
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

export interface MockHttpCall {
  method: string;
  url: string;
  body?: unknown;
}

export function createMockHttp(): HttpInterface & {
  /** All requests made, in order. */
  calls: MockHttpCall[];
  /** Pre-configure responses: url → value returned from convenience methods. */
  mockJson(url: string, response: unknown): void;
} {
  const calls: MockHttpCall[] = [];
  const mocked = new Map<string, unknown>();

  function resolve<T>(method: string, url: string, body?: unknown): Promise<T> {
    calls.push({ method, url, body });
    if (mocked.has(url)) return Promise.resolve(mocked.get(url) as T);
    return Promise.reject(new HttpError(404, "Not Found", url, `No mock configured for ${method} ${url}`));
  }

  return {
    get:    (url)        => resolve("GET",    url),
    post:   (url, body)  => resolve("POST",   url, body),
    put:    (url, body)  => resolve("PUT",    url, body),
    patch:  (url, body)  => resolve("PATCH",  url, body),
    delete: (url)        => resolve("DELETE", url),
    fetch:  (url, init)  => {
      calls.push({ method: init?.method ?? "GET", url });
      return Promise.reject(new Error("Use mockJson() for fetch mocking"));
    },
    HttpError,
    calls,
    mockJson(url: string, response: unknown) { mocked.set(url, response); },
  };
}
