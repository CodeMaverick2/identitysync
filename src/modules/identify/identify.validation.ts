import { z } from "zod";

export const identifyBodySchema = z
  .object({
    email: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : v)),
    phoneNumber: z
      .union([z.number(), z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null || v === undefined) return undefined;
        return String(v).trim() || undefined;
      }),
  })
  .refine((data) => data.email != null || data.phoneNumber != null, {
    message: "At least one of email or phoneNumber is required",
  });

export type IdentifyBody = z.infer<typeof identifyBodySchema>;
