/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";

export type ProblemDetails = {
  status: number;
  title: string;
  detail: string;
  type?: string;
};

export interface UseFetchOptions extends Omit<RequestInit, "body"> {
  url?: string;
  autoInvoke?: boolean;
  responseType?: "json" | "text" | "blob";
  body?: BodyInit | Record<string, unknown> | null;
  retry?: { count: number; delay: number };
}

export type ExecuteRequest = string | UseFetchOptions;

export interface UseFetchReturnValue<T> {
  data: T | null;
  loading: boolean;
  problemDetails: ProblemDetails | null;
  execute: (req?: ExecuteRequest) => Promise<T | null>;
  abort: () => void;
}

export interface UseSseReturnValue<T> {
  data: T | null;
  loading: boolean;
  problemDetails: ProblemDetails | null;
  execute: (req?: ExecuteRequest) => Promise<void>;
  abort: () => void;
}

type TrackErrorFn = (error: Error, properties?: unknown) => void;
type GetAuthTokenFn = () => Promise<string>;

interface QmContextValue {
  getAuthToken?: GetAuthTokenFn;
  trackError?: TrackErrorFn;
}

// Default context throws or logs if used without provider, though usage without auth might be valid for some
const QmContext = createContext<QmContextValue | null>(null);

export function QmProvider({
  getAuthToken,
  trackError,
  children,
}: PropsWithChildren<{
  getAuthToken?: GetAuthTokenFn;
  trackError?: TrackErrorFn;
}>) {
  return <QmContext.Provider value={{ getAuthToken, trackError }}>{children}</QmContext.Provider>;
}

function useQmContext() {
  const context = useContext(QmContext);
  return context || {};
}

function useCoreFetch<T>(url: string, options?: UseFetchOptions): UseFetchReturnValue<T> {
  const { getAuthToken, trackError } = useQmContext();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(options?.autoInvoke && url));
  const [problemDetails, setProblemDetails] = useState<ProblemDetails | null>(null);
  const controller = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const shouldFetch = !!url;

  const execute = useCallback(
    async (req?: ExecuteRequest): Promise<T | null> => {
      if (controller.current) {
        controller.current.abort();
      }

      let dynamicUrl: string | undefined;
      let dynamicOptions: UseFetchOptions | undefined;
      if (typeof req === "string") {
        dynamicUrl = req;
      } else if (req) {
        dynamicUrl = req.url;
        dynamicOptions = req;
      }

      const currentController = new AbortController();
      controller.current = currentController;
      setLoading(true);
      setProblemDetails(null);

      const options = optionsRef.current;
      const mergedOptions = { ...options, ...dynamicOptions } as UseFetchOptions;
      const retryConfig = mergedOptions.retry;
      let attempt = 0;
      const maxAttempts = (retryConfig?.count || 0) + 1;

      while (attempt < maxAttempts) {
        try {
          let authHeader: string | undefined;
          if (getAuthToken) {
            const token = await getAuthToken();
            if (token) {
              authHeader = `Bearer ${token}`;
            }
          }

          const responseType = mergedOptions.responseType;
          const method = mergedOptions.method || "GET";

          const headers: HeadersInit = {
            ...(options?.headers || {}),
            ...(dynamicOptions?.headers || {}),
            ...(authHeader ? { Authorization: authHeader } : {}),
          };

          // Auto-serialize body if it's an object
          let body = mergedOptions.body;
          if (
            body &&
            typeof body === "object" &&
            !(body instanceof FormData) &&
            !(body instanceof URLSearchParams) &&
            !(body instanceof ReadableStream) &&
            !(body instanceof ArrayBuffer) &&
            !(body instanceof Blob)
          ) {
            body = JSON.stringify(body);
          }

          const {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            url: _,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            retry: __,
            ...fetchInit
          } = mergedOptions as UseFetchOptions & { url?: string };

          const res = await fetch(url + (dynamicUrl || ""), {
            ...fetchInit,
            signal: currentController.signal,
            method,
            headers,
            body,
          });

          const contentType = res.headers.get("content-type") || "";
          const isJson = contentType.includes("application/json") || contentType.includes("application/problem+json");

          if (!res.ok) {
            // Retry only on 5xx errors
            if (res.status >= 500 && res.status < 600 && attempt < maxAttempts - 1) {
              attempt++;
              await new Promise((resolve) => setTimeout(resolve, retryConfig!.delay));
              continue;
            }

            const message = isJson ? await res.json() : await res.text();
            const problem = isJson
              ? (message as ProblemDetails)
              : {
                  status: res.status,
                  title: "Request failed",
                  detail: message,
                };

            setProblemDetails(problem);
            trackError?.(new Error(`Error: status: ${res.status}`), problem);
            return null;
          }

          let result: unknown;
          if (responseType === "blob") {
            const blob = await res.blob();
            let filename: string | undefined;
            const disposition = res.headers.get("Content-Disposition");
            if (disposition) {
              const match = disposition.match(/filename="?([^"]+)"?/);
              if (match) filename = match[1];
            }
            result = { blob, filename };
          } else if (responseType === "text") {
            result = await res.text();
          } else if (responseType === "json" || isJson) {
            result = await res.json();
          } else {
            // Fallback for non-JSON responses when responseType is not specified
            const text = await res.text();
            result = { status: res.status, message: text };
          }

          setProblemDetails(null);
          // Type assertion: assuming the response matches the generic type T
          setData(result as T);
          return result as T;
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return null;
          const problem: ProblemDetails = {
            status: 0,
            title: err instanceof Error ? err.name : "Network Error",
            detail: err instanceof Error ? err.message : String(err),
          };
          setProblemDetails(problem);
          trackError?.(err instanceof Error ? err : new Error(String(err)));
          return null;
        } finally {
          if (controller.current === currentController) {
            setLoading(false);
          }
        }
      }

      // Max retries exceeded
      const problem: ProblemDetails = {
        status: 0,
        title: "Max Retries Exceeded",
        detail: `${maxAttempts} maximum retry attempts exceeded`,
      };
      setProblemDetails(problem);
      return null;
    },
    [url, getAuthToken, trackError],
  );

  const abort = useCallback(() => {
    if (controller.current) {
      controller.current.abort();
    }
  }, []);

  useEffect(() => {
    return abort;
  }, [abort]);

  useEffect(() => {
    if (options?.autoInvoke && shouldFetch) {
      // Defer execution to avoid synchronous setState calls inside effects that can cause cascading renders.
      // Scheduling with Promise.resolve() ensures it runs as a microtask after the current effect completes.
      Promise.resolve().then(() => {
        execute().catch(() => {
          // Errors are already handled in execute
        });
      });
    }
  }, [shouldFetch, options?.autoInvoke, execute]);

  return { data, loading, problemDetails, execute, abort };
}

export interface UseSseOptions {
  url?: string;
  autoInvoke?: boolean;
  authQueryParam?: string;
  retry?: { count: number; delay: number };
}

function appendAuthQueryParam(url: string, token: string, paramName: string) {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set(paramName, token);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(token)}`;
  }
}

export function useSse<T>(options?: UseSseOptions): UseSseReturnValue<T> {
  const { url = "", authQueryParam = "access_token", retry } = options || {};
  const { getAuthToken, trackError } = useQmContext();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [problemDetails, setProblemDetails] = useState<ProblemDetails | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryAttemptRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const shouldConnect = !!url;

  const connectWithRetry = useCallback(
    async (baseUrl: string): Promise<void> => {
      const connect = async (): Promise<void> => {
        let finalUrl = baseUrl;
        if (authQueryParam && getAuthToken) {
          const token = await getAuthToken();
          if (token) {
            finalUrl = appendAuthQueryParam(baseUrl, token, authQueryParam);
          }
        }

        const es = new EventSource(finalUrl);
        esRef.current = es;
        setLoading(true);
        setProblemDetails(null);

        es.onopen = () => {
          retryAttemptRef.current = 0;
        };

        es.onmessage = (ev: MessageEvent) => {
          try {
            const parsed = ev.data ? JSON.parse(ev.data) : null;
            // Type assertion: assuming the parsed data matches the generic type T
            setData(parsed as T);
          } catch (err: unknown) {
            const problem: ProblemDetails = {
              status: 0,
              title: err instanceof Error ? err.name : "ParseError",
              detail: err instanceof Error ? err.message : String(err),
            };
            setProblemDetails(problem);
            trackError?.(err instanceof Error ? err : new Error(String(err)), problem);
          }
        };

        es.onerror = async () => {
          es.close();
          esRef.current = null;
          setLoading(false);

          if (retry && retryAttemptRef.current < retry.count) {
            retryAttemptRef.current++;
            await new Promise((resolve) => setTimeout(resolve, retry.delay));
            // Attempt to reconnect; connect() will refresh token on next attempt
            connect();
          } else {
            const problem: ProblemDetails = {
              status: 0,
              title: "EventSourceError",
              detail: "SSE connection failed",
            };
            setProblemDetails(problem);
            trackError?.(new Error("EventSource error"), problem);
          }
        };
      };

      await connect();
    },
    [retry, trackError, getAuthToken, authQueryParam],
  );

  const execute = useCallback(
    async (req?: ExecuteRequest): Promise<void> => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      let dynamicUrl: string | undefined;
      if (typeof req === "string") {
        dynamicUrl = req;
      } else if (req) {
        dynamicUrl = req.url;
      }

      const baseUrl = url + (dynamicUrl || "");
      retryAttemptRef.current = 0;

      await connectWithRetry(baseUrl);
    },
    [url, connectWithRetry],
  );

  const abort = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return abort;
  }, [abort]);

  useEffect(() => {
    if (options?.autoInvoke && shouldConnect) {
      // Defer execution to avoid synchronous setState calls inside effects that can cause cascading renders.
      // Scheduling with Promise.resolve() ensures it runs as a microtask after the current effect completes.
      Promise.resolve().then(() => {
        execute().catch(() => {
          // Errors are already handled in execute
        });
      });
    }
  }, [shouldConnect, execute, options?.autoInvoke]);

  return { data, loading, problemDetails, execute, abort };
}

/**
 * useQuery
 *
 * Usage:
 *  useQuery({ url?, ...options? })
 */
export function useQuery<T>(options?: Omit<UseFetchOptions, "method">) {
  const { url = "", ...fetchOptions } = options || {};
  const { execute, ...rest } = useCoreFetch<T>(url, {
    ...fetchOptions,
    method: "GET",
    autoInvoke: options?.autoInvoke ?? false,
  });

  return { ...rest, execute };
}

function mergeHeaders(base: HeadersInit | undefined, additional: Record<string, string>): HeadersInit {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(additional)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * useMutation
 *
 * Usage:
 *  useMutation({ url?, ...options? })
 */
export function useMutation<T>(options?: Omit<UseFetchOptions, "autoInvoke">) {
  const { url = "", ...fetchOptions } = options || {};

  const headers = mergeHeaders(fetchOptions.headers, { "Content-Type": "application/json" });

  const { execute, ...rest } = useCoreFetch<T>(url, {
    ...fetchOptions,
    method: fetchOptions.method || "POST",
    headers,
    autoInvoke: false,
  });

  return {
    ...rest,
    execute,
  };
}
