import { NextResponse } from "next/server";
import { SHIFT_S } from "@/sim/config";
import { view } from "./mes";
import type { MesView } from "./mes";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...CORS, ...init.headers } });
}

export function text(body: string, contentType: string, filename?: string) {
  return new NextResponse(body, { headers: { ...CORS, "Content-Type": contentType, ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}) } });
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, { status: e.status });
  const message = e instanceof Error ? e.message : "unexpected error";
  return json({ error: { code: "internal", message } }, { status: 500 });
}

export function intParam(url: URL, name: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, "bad_parameter", `${name} must be a number from ${min} to ${max}`);
  return Math.floor(n);
}

/** Resolves ?source=, ?seed= and ?t= into the data the endpoint answers from. */
export function resolve(url: URL): MesView {
  const source = url.searchParams.get("source");
  if (source !== null && source !== "simulation" && source !== "live") throw new ApiError(400, "bad_parameter", "source must be simulation or live");
  const seed = intParam(url, "seed", 1, 1, 9999);
  const t = intParam(url, "t", 7200, 0, SHIFT_S);
  const v = view(source, seed, t);
  if ("error" in v) throw new ApiError(503, "live_unavailable", v.error);
  return v;
}

export const handler =
  (fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>) =>
  async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
