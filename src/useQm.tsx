import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

export type ProblemDetails = {
  status: number;
  title: string;
  detail: string;
  type?: string;
};

export interface UseFetchOptions extends RequestInit {
  autoInvoke?: boolean;
  responseType?: "json" | "text" | "blob";
}

export interface UseFetchReturnValue<T> {
  data: T | null;
  loading: boolean;
  problemDetails: ProblemDetails | null;
  execute: (
    dynamicUrl?: string,
    dynamicOptions?: UseFetchOptions
  ) => Promise<T | null>;
  abort: () => void;
}

type TrackErrorFn = (error: Error, properties?: any) => void;
type GetAuthHeaderFn = () => Promise<string>;

interface QmContextValue {
  getAuthHeader?: GetAuthHeaderFn;
  trackError?: TrackErrorFn;
}

// Default context throws or logs if used without provider, though usage without auth might be valid for some
const QmContext = createContext<QmContextValue | null>(null);

export function QmProvider({
  getAuthHeader,
  trackError,
  children,
}: PropsWithChildren<{
  getAuthHeader?: GetAuthHeaderFn;
  trackError?: TrackErrorFn;
}>) {
  return (
    <QmContext.Provider value={{ getAuthHeader, trackError }}>
      {children}
    </QmContext.Provider>
  );
}

function useQmContext() {
  const context = useContext(QmContext);
  return context || {};
}

function useCoreFetch<T>(
  url: string,
  options?: UseFetchOptions
): UseFetchReturnValue<T> {
  const { getAuthHeader, trackError } = useQmContext();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [problemDetails, setProblemDetails] = useState<ProblemDetails | null>(
    null
  );
  const controller = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const shouldFetch = !!url;

  const execute = useCallback(
    async (
      dynamicUrl?: string,
      dynamicOptions?: UseFetchOptions
    ): Promise<T | null> => {
      if (controller.current) {
        controller.current.abort();
      }

      const currentController = new AbortController();
      controller.current = currentController;
      setLoading(true);
      setProblemDetails(null);

      try {
        let authHeader: string | undefined;
        if (getAuthHeader) {
          authHeader = await getAuthHeader();
        }

        const options = optionsRef.current;
        const mergedOptions = { ...options, ...dynamicOptions };
        const responseType = mergedOptions.responseType;
        const method = mergedOptions.method || "GET";
        
        const headers: HeadersInit = {
          ...(options?.headers || {}),
          ...(dynamicOptions?.headers || {}),
          ...(authHeader ? { Authorization: authHeader } : {}),
        };

        const res = await fetch(url + (dynamicUrl || ""), {
          ...mergedOptions,
          signal: currentController.signal,
          method,
          headers,
        });

        const contentType = res.headers.get("content-type") || "";
        const isJson =
          contentType.includes("application/json") ||
          contentType.includes("application/problem+json");

        if (!res.ok) {
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

        let result: any;
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
          const text = await res.text();
          result = { status: res.status, message: text };
        }

        setProblemDetails(null);
        setData(result);
        return result as T;
      } catch (err: any) {
        if (err.name === "AbortError") return null;
        setProblemDetails(err as ProblemDetails);
        trackError?.(err);
        return null;
      } finally {
        if (controller.current === currentController) {
          setLoading(false);
        }
      }
    },
    [url, getAuthHeader, trackError]
  );

  const abort = useCallback(() => {
    if (controller.current) {
      controller.current.abort("");
    }
  }, []);

  useEffect(() => {
    return abort;
  }, [abort]);

  useEffect(() => {
    if (options?.autoInvoke && shouldFetch) {
      // Execute immediately implies we shouldn't wait, but we need execute to be stable or this effect to run.
      // We can just call execute.
      execute().catch(() => {
        // Already handled in execute
      });
    }
  }, [shouldFetch, options?.autoInvoke, execute]);

  return { data, loading, problemDetails, execute, abort };
}

/**
 * useQuery
 *
 * Variable signatures:
 * 1. useQuery(url, options)
 */
export function useQuery<T>(
  url: string,
  options?: Omit<UseFetchOptions, "method">
) {
  const { execute, ...rest } = useCoreFetch<T>(url, {
    ...options,
    method: "GET",
    autoInvoke: options?.autoInvoke ?? true,
  });

  const query = useCallback(() => {
    return execute();
  }, [execute]);

  return { ...rest, query };
}

/**
 * useMutation
 *
 * Variable signatures:
 * 1. useMutation(url, options)
 */
export function useMutation<T>(
  url: string,
  options?: Omit<UseFetchOptions, "autoInvoke">
) {
  const { execute, ...rest } = useCoreFetch<T>(url, {
    ...options,
    method: options?.method || "POST",
    headers: {
      ...(options?.headers || {}),
      ...(options?.headers &&
      Object.keys(options.headers).some(
        (key) => key.toLowerCase() === "content-type"
      )
        ? {}
        : { "Content-Type": "application/json" }),
    },
    autoInvoke: false,
  });

  return {
    data: rest.data,
    loading: rest.loading,
    problemDetails: rest.problemDetails,
    mutate: execute,
    abort: rest.abort,
  };
}
