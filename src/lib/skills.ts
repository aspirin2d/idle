import z from "zod";

const baseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // set priority by int or function
  priority: z.union([
    z.int(),
    z.function({
      input: z.any().nullish(),
      output: z.int(),
    }),
  ]),
  executable: z.union([
    z.boolean(),
    z.function({
      input: z.any().nullish(),
      output: z.boolean(),
    }),
  ]),
});

const skill = z.object({
  ...baseSchema,
  targets: z.array(z.string()),
});

const skillTarget = z.object({
  ...baseSchema,
});
