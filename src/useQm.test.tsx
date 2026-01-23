import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QmProvider, useQuery, useMutation, useSse } from "./useQm";
import { type PropsWithChildren } from "react";

// Mock global fetch
const globalFetch = vi.fn();
globalThis.fetch = globalFetch;

describe("useQm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("QmProvider", () => {
    it("provides context to children", () => {
      const wrapper = ({ children }: PropsWithChildren) => (
        <QmProvider getAuthToken={async () => "Bearer token"}>
          {children}
        </QmProvider>
      );

      const { result } = renderHook(() => useQuery({ url: "/test" }), { wrapper });
      // If it doesn't throw, context is provided.
      // We can check if fetch is called with auth header later.
      expect(result.current).toBeDefined();
    });
  });

  describe("useQuery", () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QmProvider>{children}</QmProvider>
    );

    it("fetches data successfully", async () => {
      const mockData = { id: 1, name: "Test" };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => mockData,
      });

      const { result } = renderHook(() => useQuery({ url: "/api/data", autoInvoke: true }), { wrapper });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(result.current.problemDetails).toBeNull();
      expect(globalFetch).toHaveBeenCalledWith(
        "/api/data",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("handles errors", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: { get: () => "application/json" },
        json: async () => ({ title: "Not Found", status: 404 }),
      });

      const { result } = renderHook(() => useQuery({ url: "/api/error", autoInvoke: true }), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toBeNull();
      expect(result.current.problemDetails).toEqual({
        title: "Not Found",
        status: 404,
      });
    });

    it("uses getAuthHeader from provider", async () => {
      const getAuthHeader = vi.fn().mockResolvedValue("secret");
      const customWrapper = ({ children }: PropsWithChildren) => (
        <QmProvider getAuthToken={getAuthHeader}>{children}</QmProvider>
      );

      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      });

      const { result } = renderHook(() => useQuery({ url: "/api/auth", autoInvoke: true }), {
        wrapper: customWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(getAuthHeader).toHaveBeenCalled();
      expect(globalFetch).toHaveBeenCalledWith(
        "/api/auth",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer secret",
          }),
        })
      );
    });

    it("refetches using query method", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ count: 1 }),
      });

      const { result } = renderHook(() => useQuery({ url: "/api/refresh", autoInvoke: true }), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ count: 1 });

      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ count: 2 }),
      });

      act(() => {
        result.current.execute();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ count: 2 });
    });
  });

  describe("useMutation", () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QmProvider>{children}</QmProvider>
    );

    it("does not auto-invoke", () => {
      const { result } = renderHook(() => useMutation({ url: "/api/create" }), {
        wrapper,
      });
      expect(globalFetch).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
    });

    it("executes mutation when mutate is called", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useMutation({ url: "/api/create" }), {
        wrapper,
      });

      act(() => {
        result.current.execute({
          body: { name: "New" },
        });
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ success: true });
      expect(globalFetch).toHaveBeenCalledWith(
        "/api/create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New" }),
        })
      );
    });

    it("auto-serializes object bodies to JSON", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ id: 1 }),
      });

      const { result } = renderHook(() => useMutation({ url: "/api/test" }), {
        wrapper,
      });

      const testObject = { name: "Test", value: 42 };

      act(() => {
        result.current.execute({ body: testObject });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(globalFetch).toHaveBeenCalledWith(
        "/api/test",
        expect.objectContaining({
          body: JSON.stringify(testObject),
        })
      );
    });

    it("does not serialize FormData bodies", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useMutation({ url: "/api/upload" }), {
        wrapper,
      });

      const formData = new FormData();
      formData.append("file", "test");

      act(() => {
        result.current.execute({ body: formData });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(globalFetch).toHaveBeenCalledWith(
        "/api/upload",
        expect.objectContaining({
          body: formData,
        })
      );
    });
  });

  describe("Hooks without QmProvider", () => {
    it("useQuery works without QmProvider", async () => {
      const mockData = { id: 1, name: "No Provider" };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => mockData,
      });

      // No wrapper provided, so QmContext will be null
      const { result } = renderHook(() => useQuery({ url: "/api/no-provider", autoInvoke: true }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
    });

    it("useMutation works without QmProvider", async () => {
      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useMutation({ url: "/api/no-provider" }));

      act(() => {
        result.current.execute();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ success: true });
    });
  });

  describe("useSse", () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <QmProvider>{children}</QmProvider>
    );

    class MockEventSource {
      static instances: MockEventSource[] = [];
      static lastInstance: MockEventSource | null = null;
      url: string;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      closed = false;

      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
        MockEventSource.lastInstance = this;
      }

      close() {
        this.closed = true;
      }

      emitOpen() {
        if (this.onopen) {
          this.onopen(new Event("open"));
        }
      }

      emitMessage(data: string) {
        if (this.onmessage) {
          this.onmessage({ data } as unknown as MessageEvent);
        }
      }

      emitError() {
        if (this.onerror) {
          this.onerror(new Event("error"));
        }
      }
    }

    let originalEventSource: typeof EventSource | undefined;

    beforeEach(() => {
      originalEventSource = globalThis.EventSource;
      MockEventSource.instances = [];
      MockEventSource.lastInstance = null;
      globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    });

    afterEach(() => {
      if (originalEventSource !== undefined) {
        globalThis.EventSource = originalEventSource;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).EventSource;
      }
    });

    it("connects and opens automatically", async () => {
      const { result } = renderHook(() => useSse({ url: "/sse", autoInvoke: true }), {
        wrapper,
      });

      // wait for microtask to create EventSource
      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      act(() => {
        MockEventSource.lastInstance!.emitOpen();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });
    });

    it("parses JSON messages and updates data", async () => {
      const { result } = renderHook(() => useSse<{ value: number }>({ url: "/sse", autoInvoke: true }), {
        wrapper,
      });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      act(() => {
        MockEventSource.lastInstance!.emitMessage(JSON.stringify({ value: 42 }));
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({ value: 42 });
      });
    });

    it("sets problemDetails on parse error", async () => {
      const { result } = renderHook(() => useSse<{ value: number }>({ url: "/sse", autoInvoke: true }), {
        wrapper,
      });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      act(() => {
        MockEventSource.lastInstance!.emitMessage("not-json");
      });

      await waitFor(() => {
        expect(result.current.problemDetails).not.toBeNull();
      });

      expect(result.current.data).toBeNull();
    });

    it("abort() closes the stream", async () => {
      const { result } = renderHook(() => useSse({ url: "/sse", autoInvoke: true }), { wrapper });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      act(() => {
        result.current.abort();
      });

      expect(MockEventSource.lastInstance!.closed).toBe(true);
      expect(result.current.loading).toBe(false);
    });

    it("execute() restarts the stream", async () => {
      const { result } = renderHook(() => useSse({ url: "/sse", autoInvoke: true }), { wrapper });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      const first = MockEventSource.lastInstance;

      act(() => {
        result.current.abort();
      });

      expect(first!.closed).toBe(true);

      act(() => {
        result.current.execute();
      });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBe(first);
      });
    });

    it("appends auth token to URL when getAuthHeader is provided and authQueryParam is set", async () => {
      const getAuthHeader = vi.fn().mockResolvedValue("secret-token");
      const customWrapper = ({ children }: PropsWithChildren) => (
        <QmProvider getAuthToken={getAuthHeader}>{children}</QmProvider>
      );

      renderHook(() => useSse({ url: "/sse", authQueryParam: "token", autoInvoke: true }), {
        wrapper: customWrapper,
      });

      await waitFor(() => {
        expect(MockEventSource.lastInstance).not.toBeNull();
      });

      expect(MockEventSource.lastInstance!.url).toContain("token=secret-token");
    });
  });
});
