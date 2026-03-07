import express from "express";
import type { Pool } from "pg";
import { createIdentifyService } from "./modules/identify/identify.service.js";
import { createIdentifyController } from "./modules/identify/identify.controller.js";

export function createApp(pool: Pool): express.Application {
  const app = express();
  app.use(express.json());

  const identifyService = createIdentifyService(pool);
  const identifyController = createIdentifyController(identifyService);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/identify", (req, res) => {
    void identifyController.postIdentify(req, res);
  });

  return app;
}
