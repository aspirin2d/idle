import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseRequestBody, removeUndefined } from "./utils.js";

function createContext(body: unknown, opts: { reject?: boolean } = {}) {
  const jsonMock = opts.reject
    ? vi.fn().mockRejectedValue(new Error("bad json"))
    : vi.fn().mockResolvedValue(body);
  const responseMock = vi.fn(
    (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status }),
  );

  return {
    ctx: {
      req: { json: jsonMock },
      json: responseMock,
    } as unknown,
    jsonMock,
    responseMock,
  };
}

describe("route utilities", () => {
  it("parses valid request bodies", async () => {
    const schema = z.object({ name: z.string() });
    const { ctx } = createContext({ name: "Ada" });

    const result = await parseRequestBody(ctx as any, schema, "Bad request");
    expect(result).toEqual({ success: true, data: { name: "Ada" } });
  });

  it("rejects invalid JSON", async () => {
    const schema = z.object({ name: z.string() });
    const { ctx } = createContext(null, { reject: true });

    const result = await parseRequestBody(ctx as any, schema, "Bad request");
    expect(result.success).toBe(false);
    const body = await result.response.json();
    expect(body).toEqual({ error: "Invalid JSON body" });
  });

  it("returns validation errors when schema parsing fails", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const { ctx } = createContext({ name: "" });

    const result = await parseRequestBody(ctx as any, schema, "Bad request");
    expect(result.success).toBe(false);
    const body = await result.response.json();
    expect(body.error).toBe("Bad request");
    expect(body.details).toBeDefined();
  });

  it("removes undefined values while preserving others", () => {
    const cleaned = removeUndefined({
      a: 1,
      b: undefined,
      c: null,
      d: 0,
    });

    expect(cleaned).toEqual({ a: 1, c: null, d: 0 });
  });
});
