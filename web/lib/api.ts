"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { components, paths } from "./api-types";

/**
 * The ONLY source of request/response types in web/ is lib/api-types.ts,
 * generated from api/openapi.json. Never hand-write a shape here.
 */
export type Schemas = components["schemas"];

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api";

/** A failed HTTP call. Carries status + best-effort parsed body. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      ...init,
    });
  } catch (err) {
    // Network / CORS / server-down. Surface a human message, never crash.
    throw new ApiError(
      0,
      "Cannot reach Robyn's API. Check the connection and try again.",
      err,
    );
  }

  const text = await res.text();
  const parsed = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : undefined;

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as Record<string, unknown>).message)
        : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

/* -------------------------------------------------------------------------- */
/*  Typed path helpers — GET response type inferred from the OpenAPI spec.      */
/* -------------------------------------------------------------------------- */

type JsonBody<T> = T extends { content: { "application/json": infer C } }
  ? C
  : never;

/** Paths that expose a GET returning application/json. */
export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: { responses: { 200: unknown } } }
    ? P
    : never;
}[keyof paths];

/** Response type for a GET path (200 application/json body). */
export type GetResponse<P extends GetPath> = paths[P] extends {
  get: { responses: { 200: infer R } };
}
  ? JsonBody<R>
  : never;

/** Typed GET keyed by an OpenAPI path literal. Response type is inferred. */
export function apiGet<P extends GetPath>(
  path: P,
  init?: RequestInit,
): Promise<GetResponse<P>> {
  return request<GetResponse<P>>("GET", path as string, undefined, init);
}

/** Loosely-typed GET for dynamic URLs (path params, query strings). */
export function get<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>("GET", path, undefined, init);
}

export function post<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  return request<T>("POST", path, body, init);
}

export function patch<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  return request<T>("PATCH", path, body, init);
}

/* -------------------------------------------------------------------------- */
/*  Data hooks — native fetch with loading / error / refetch, no extra deps.    */
/* -------------------------------------------------------------------------- */

export interface UseApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  isLoading: boolean;
  /** True on a background refetch while stale data is still shown. */
  isValidating: boolean;
  refetch: () => void;
}

/**
 * Fetch `path` on mount (and when it changes). Returns loading/error/data plus
 * a `refetch`. Pass `path = null` to skip (e.g. waiting on a param).
 */
export function useApi<T>(
  path: string | null,
  options?: { refreshMs?: number },
): UseApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(path != null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const activeRef = useRef(0);

  const load = useCallback(
    async (isRefetch: boolean) => {
      if (path == null) return;
      const ticket = ++activeRef.current;
      if (isRefetch) setIsValidating(true);
      else setIsLoading(true);
      try {
        const result = await get<T>(path);
        if (ticket !== activeRef.current) return;
        setData(result);
        setError(undefined);
      } catch (err) {
        if (ticket !== activeRef.current) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(0, "Something went wrong.", err),
        );
      } finally {
        if (ticket === activeRef.current) {
          setIsLoading(false);
          setIsValidating(false);
        }
      }
    },
    [path],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!options?.refreshMs || path == null) return;
    const id = setInterval(() => void load(true), options.refreshMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, options?.refreshMs]);

  const refetch = useCallback(() => void load(true), [load]);

  return { data, error, isLoading, isValidating, refetch };
}

/**
 * Run a one-shot mutation with in-flight + error state, for buttons.
 * `run()` returns the result (or throws) so callers can chain toasts/refetch.
 */
export function useAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setIsPending(true);
      setError(undefined);
      try {
        return await fn(...args);
      } catch (err) {
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError(0, "Something went wrong.", err);
        setError(apiErr);
        throw apiErr;
      } finally {
        setIsPending(false);
      }
    },
    [fn],
  );

  return { run, isPending, error };
}
