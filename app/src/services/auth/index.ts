/**
 * Auth Provider Factory
 * 
 * Creates and manages authentication providers.
 */

import type { AuthProvider, AuthProviderType } from './AuthProvider';
import { GoogleAuthProvider } from './GoogleAuthProvider';
import { TwitchAuthProvider } from './TwitchAuthProvider';

export type { AuthProvider, AuthProviderType, CredentialCallback, CredentialResponse } from './AuthProvider';

const providers: Map<AuthProviderType, AuthProvider> = new Map();

export function getAuthProvider(type: AuthProviderType): AuthProvider {
  let provider = providers.get(type);
  
  if (!provider) {
    switch (type) {
      case 'google':
        provider = new GoogleAuthProvider();
        break;
      case 'twitch':
        provider = new TwitchAuthProvider();
        break;
      default:
        throw new Error(`Unknown auth provider: ${type}`);
    }
    providers.set(type, provider);
  }
  
  return provider;
}

export function resetAllProviders(): void {
  providers.forEach(provider => provider.reset());
  providers.clear();
}

export function isValidProviderType(type: string): type is AuthProviderType {
  return type === 'google' || type === 'twitch';
}
