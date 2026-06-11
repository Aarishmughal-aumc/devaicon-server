import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { env } from "./config/env.js";
import { loadUser } from "./middleware/auth.js";
import { sameOriginGuard } from "./middleware/originCheck.js";

import authRoutes from "./routes/auth.js";
import logsRoutes from "./routes/logs.js";
import projectsRoutes from "./routes/projects.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use(loadUser);
  app.use(sameOriginGuard);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/logs", logsRoutes);
  app.use("/api/projects", projectsRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: "server_error" });
  });

  return app;
}
