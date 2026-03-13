/**
 * Vercel Serverless Function entry point
 * All /api/* requests are handled here via Express
 */
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Boot routes (async IIFE, resolved before first request in serverless)
let ready = false;
const boot = (async () => {
  await registerRoutes(httpServer, app);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });
  ready = true;
})();

export default async function handler(req: Request, res: Response) {
  if (!ready) await boot;
  return app(req, res);
}
