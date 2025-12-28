import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QmProvider, useQuery, useMutation } from "./useQm";
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
        <QmProvider getAuthHeader={async () => "Bearer token"}>
          {children}
        </QmProvider>
      );

      const { result } = renderHook(() => useQuery("/test"), { wrapper });
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

      const { result } = renderHook(() => useQuery("/api/data"), { wrapper });

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

      const { result } = renderHook(() => useQuery("/api/error"), { wrapper });

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
      const getAuthHeader = vi.fn().mockResolvedValue("Bearer secret");
      const customWrapper = ({ children }: PropsWithChildren) => (
        <QmProvider getAuthHeader={getAuthHeader}>{children}</QmProvider>
      );

      globalFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      });

      const { result } = renderHook(() => useQuery("/api/auth"), {
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

      const { result } = renderHook(() => useQuery("/api/refresh"), {
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
        result.current.query();
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
      const { result } = renderHook(() => useMutation("/api/create"), {
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

      const { result } = renderHook(() => useMutation("/api/create"), {
        wrapper,
      });

      act(() => {
        result.current.mutate(undefined, {
          body: JSON.stringify({ name: "New" }),
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
      const { result } = renderHook(() => useQuery("/api/no-provider"));

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

      const { result } = renderHook(() => useMutation("/api/no-provider"));

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ success: true });
    });
  });
});
