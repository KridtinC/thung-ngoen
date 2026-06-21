import { Elysia } from 'elysia';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';

// index.html is served with no-store so the LINE WebView never caches stale HTML.
function serveIndex(set: any) {
  set.headers['Cache-Control'] = 'no-store, must-revalidate';
  set.headers['Content-Type'] = 'text/html; charset=utf-8';
  return readFileSync('./public/index.html');
}

// Static HTML + health/config endpoints. Registered BEFORE the static-file plugin
// so the no-store index route wins over plain file serving.
export const staticRoutes = new Elysia({ name: 'static' })
  .get('/', ({ set }) => serveIndex(set))
  .get('/index.html', ({ set }) => serveIndex(set))
  .get('/health', () => ({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  }))
  // Frontend config (LIFF ID etc.)
  .get('/api/config', () => ({
    liffId: process.env.LINE_LIFF_ID || 'mock-liff-id'
  }));
