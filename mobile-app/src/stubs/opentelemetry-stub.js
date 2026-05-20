// Stub for @opentelemetry/api
// @supabase/supabase-js dynamically imports this with webpackIgnore/vite-ignore
// comments that Metro does not honour. This stub satisfies Metro's static
// resolver so that `expo export --platform web` succeeds.
// OpenTelemetry tracing is not used in this React Native app.

const noopTracer = {
  startSpan: () => ({ end: () => {}, setAttribute: () => {}, setStatus: () => {}, recordException: () => {} }),
  startActiveSpan: (_name, _opts, fn) => {
    if (typeof _opts === 'function') return _opts({ end: () => {}, setAttribute: () => {}, setStatus: () => {}, recordException: () => {} });
    if (typeof fn === 'function') return fn({ end: () => {}, setAttribute: () => {}, setStatus: () => {}, recordException: () => {} });
  },
};

const noopTracerProvider = {
  getTracer: () => noopTracer,
};

module.exports = {
  trace: {
    getTracer: () => noopTracer,
    getTracerProvider: () => noopTracerProvider,
    setGlobalTracerProvider: () => {},
    wrapSpanContext: (ctx) => ctx,
    isSpanContextValid: () => false,
  },
  context: {
    active: () => ({}),
    with: (_ctx, fn) => fn(),
    bind: (_ctx, fn) => fn,
  },
  propagation: {
    inject: () => {},
    extract: (_ctx, carrier) => carrier || {},
    fields: () => [],
  },
  diag: {
    setLogger: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    verbose: () => {},
  },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  SpanKind: { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
};
