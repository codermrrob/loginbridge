/**
 * Bridge Application Configuration
 */

export interface BridgeConfig {
  enokiApiKey: string;
  backendUrl: string;
  googleClientId: string;
}

export function getBridgeConfig(): BridgeConfig {
  // In a real project, these would come from import.meta.env
  // For the kickstart, we'll use placeholders or expected env vars
  const enokiApiKey = import.meta.env.VITE_ENOKI_PUBLIC_API_KEY || '';
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7071';
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  // In the final app, we should throw if missing
  // if (!enokiApiKey || !backendUrl || !googleClientId) {
  //   throw new Error('Missing required environment variables');
  // }

  return {
    enokiApiKey,
    backendUrl,
    googleClientId
  };
}

export const CONFIG = getBridgeConfig();
