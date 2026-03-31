/**
 * Auth Provider Interface
 * 
 * Base interface for OAuth/OIDC authentication providers.
 * Supports both popup-based (Google) and redirect-based (Twitch) flows.
 */

export type AuthProviderType = 'google' | 'twitch';

export interface CredentialResponse {
  credential: string;
  provider: AuthProviderType;
}

export type CredentialCallback = (response: CredentialResponse) => void;

export interface AuthProvider {
  readonly name: AuthProviderType;
  
  /**
   * Load any required external scripts
   */
  loadScript(): Promise<void>;
  
  /**
   * Initialize the provider with zkLogin nonce
   */
  initialize(nonce: string, callback: CredentialCallback): void;
  
  /**
   * Render the sign-in button
   */
  renderButton(container: HTMLElement): void;
  
  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean;
  
  /**
   * Reset provider state
   */
  reset(): void;
  
  /**
   * Cancel any ongoing auth flow
   */
  cancel(): void;
  
  /**
   * For redirect-based flows: initiate the OAuth redirect
   */
  initiateAuth?(): void;
  
  /**
   * For redirect-based flows: handle the callback and extract credential
   * Returns the credential if this is a valid callback, null otherwise
   */
  handleCallback?(): CredentialResponse | null;
  
  /**
   * Check if current URL is a callback from this provider
   */
  isCallback?(): boolean;
}
