const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js performs a dynamic import of @opentelemetry/api marked
// with /* webpackIgnore: true */ and /* @vite-ignore */ so webpack/vite skip it.
// Metro does not honour those comment hints and tries to resolve it statically,
// which breaks `expo export --platform web`. Redirect to an empty stub so the
// web bundle succeeds without pulling in the full OTel SDK.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opentelemetry/api') {
    return {
      filePath: require.resolve('./src/stubs/opentelemetry-stub.js'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
