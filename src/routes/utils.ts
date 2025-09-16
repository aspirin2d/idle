import type { Context } from "hono";
import { z } from "zod";

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; response: Response };

export async function parseRequestBody<T>(
  c: Context,
  schema: z.ZodType<T>,
  errorMessage: string,
): Promise<ParseSuccess<T> | ParseFailure> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      success: false,
      response: c.json({ error: "Invalid JSON body" }, 400),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      success: false,
      response: c.json(
        {
          error: errorMessage,
          details: z.treeifyError(result.error),
        },
        400,
      ),
    };
  }

  return { success: true, data: result.data };
}

export function removeUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
