/**
 * Bridge Application Configuration
 * 
 * Supports two modes:
 * 1. Hash fragment (secure) - Desktop app passes secrets via URL hash
 * 2. Environment variables (development) - Fallback for local dev
 */

export interface BridgeConfig {
  /** Azure Function App backend URL */
  backendUrl: string;
  /** Google OAuth Client ID */
  googleClientId: string;
  /** Azure Functions key (if required) */
  funcKey?: string;
  /** Obsidian deeplink protocol */
  deeplinkProtocol: string;
  /** Deeplink callback path */
  deeplinkCallback: string;
}

/** Module-level storage for runtime config (parsed from hash) */
let runtimeConfig: BridgeConfig | null = null;

/**
 * Parse sensitive config from URL hash fragment.
 * Hash fragments are never sent to the server, making them secure for passing secrets.
 * 
 * Expected format: #funcKey=XXX&backendUrl=YYY (optional params override env vars)
 */
function parseConfigFromHash(): Partial<BridgeConfig> | null {
  const hash = window.location.hash;
  
  console.log('[Config] Parsing hash fragment:', {
    hash: hash ? hash.substring(0, 50) + '...' : '(empty)',
    search: window.location.search,
  });
  
  if (!hash || hash.length <= 1) {
    console.log('[Config] No hash fragment found');
    return null;
  }
  
  // Skip if this is an OAuth callback (contains id_token)
  if (hash.includes('id_token=')) {
    console.log('[Config] Skipping - OAuth callback detected');
    return null;
  }
  
  const params = new URLSearchParams(hash.slice(1));
  
  // Check for funcKey - the primary secret we expect from hash
  const funcKey = params.get('funcKey');
  console.log('[Config] funcKey from hash:', funcKey ? '✓ found' : '✗ not found');
  
  if (!funcKey) return null;
  
  // Clear hash immediately for security (preserve query string)
  const cleanUrl = window.location.origin + window.location.pathname + window.location.search;
  console.log('[Config] Clearing hash, new URL:', cleanUrl);
  window.history.replaceState(null, '', cleanUrl);
  
  return {
    funcKey,
    // Optional overrides from hash
    backendUrl: params.get('backendUrl') || undefined,
    googleClientId: params.get('clientId') || undefined,
  };
}

/**
 * Get bridge configuration.
 * Tries hash fragment first (for secrets), falls back to env vars.
 */
export function getBridgeConfig(): BridgeConfig {
  // Return cached config if already parsed
  if (runtimeConfig) return runtimeConfig;
  
  // Try to parse secrets from hash fragment
  const hashConfig = parseConfigFromHash();
  
  // Build config: hash values override env vars
  runtimeConfig = {
    backendUrl: hashConfig?.backendUrl || import.meta.env.VITE_BACKEND_URL || 'http://localhost:7071',
    googleClientId: hashConfig?.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    funcKey: hashConfig?.funcKey || undefined,  // Only from hash fragment, never from env (security)
    deeplinkProtocol: 'obsidian',
    deeplinkCallback: 'enoki-auth',
  };
  
  // Log configuration status
  console.log('[Config] Bridge configuration loaded:', {
    backendUrl: runtimeConfig.backendUrl,
    googleClientId: runtimeConfig.googleClientId ? '✓ set' : '✗ MISSING',
    funcKey: runtimeConfig.funcKey ? '✓ set (from hash)' : '✗ MISSING - expected #funcKey=xxx in URL',
  });

  if (!runtimeConfig.funcKey) {
    console.warn('[Config] Function key not found. The plugin should pass it via URL hash: #funcKey=xxx');
  }
  
  return runtimeConfig;
}

/**
 * Validate required configuration.
 * Throws if critical config is missing.
 */
export function validateConfig(): void {
  const config = getBridgeConfig();
  if (!config.backendUrl) {
    throw new Error('VITE_BACKEND_URL environment variable is required');
  }
  if (!config.googleClientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID environment variable is required');
  }
  if (!config.funcKey) {
    throw new Error('Function key is required. The plugin must pass it via URL hash: #funcKey=xxx');
  }
}

/**
 * Check if the app has required secrets.
 * Call this after initialization to verify config is complete.
 */
export function hasRequiredSecrets(): boolean {
  const config = getBridgeConfig();
  return Boolean(config.googleClientId && config.backendUrl);
}

export const CONFIG = getBridgeConfig();
