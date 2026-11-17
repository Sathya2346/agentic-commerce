import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { initSchemaAndSeed } from './server/db';
import { registerAuthRoutes, resolveAuth } from './server/auth';
import { registerCommerceRoutes } from './server/commerce';
import { registerAiRoutes } from './server/aiOrchestrator';
import { startBackgroundWorker } from './server/worker';

async function startServer() {
  initSchemaAndSeed();
  startBackgroundWorker();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Attach correlationId to every request
  app.use((req, res, next) => {
    const corr = String(req.headers['x-correlation-id'] || crypto.randomUUID().slice(0, 12));
    req.correlationId = corr;
    res.setHeader('X-Correlation-Id', corr);
    next();
  });

  app.use(resolveAuth);

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agentic-commerce', timestamp: new Date().toISOString() });
  });

  registerAuthRoutes(app);
  registerCommerceRoutes(app);
  registerAiRoutes(app);

  // Unknown API routes return structured JSON 404
  app.use('/api', (req, res) => {
    res.status(404).json({
      code: 'NOT_FOUND',
      message: `API endpoint ${req.method} ${req.originalUrl} not found.`,
      fieldErrors: [],
      correlationId: req.correlationId,
    });
  });

  // Global error handler — never leak stack traces
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err ? Number((err as { statusCode: number }).statusCode) : 500;
    const code =
      typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: string }).code) : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      code,
      message,
      fieldErrors: [],
      correlationId: req.correlationId,
    });
  });

  const PORT = 3000;
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agentic Commerce full-stack server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
