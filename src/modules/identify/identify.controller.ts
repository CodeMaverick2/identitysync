import type { Request, Response } from "express";
import type { IdentifyService } from "./identify.service.js";
import { identifyBodySchema } from "./identify.validation.js";

export function createIdentifyController(service: IdentifyService) {
  return {
    async postIdentify(req: Request, res: Response): Promise<void> {
      const parsed = identifyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      try {
        const result = await service.identify(parsed.data);
        res.status(200).json(result);
      } catch (err) {
        console.error("Identify error:", err);
        res.status(500).json({
          error: "Internal server error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  };
}
