/**
 * Bridge Application Types
 */

/**
 * Bridge state machine states
 */
export type BridgeStatus =
  | 'idle'              // Waiting for parameters or user action
  | 'initializing'      // Loading Google Identity Services
  | 'ready'             // Ready to show login button
  | 'authenticating'    // Google sign-in in progress
  | 'exchanging'        // Exchanging Google token for Azure session
  | 'hydrating'         // Calling bridge API for salt/address
  | 'ejecting'          // Redirecting to Obsidian
  | 'success'           // Complete, showing manual link
  | 'error';            // Error state

/**
 * Complete authentication data returned to Obsidian
 */
export interface AuthenticationResult {
  /** Google ID Token (JWT with zkLogin nonce) */
  jwt: string;
  /** Azure Easy Auth session token */
  azureToken: string;
  /** Enoki user salt */
  salt: string;
  /** Sui zkLogin address */
  address: string;
}

/**
 * Bridge component state
 */
export interface BridgeState {
  status: BridgeStatus;
  message: string;
  error?: string;
  data?: Partial<AuthenticationResult>;
}

/**
 * Parameters received from Obsidian via URL
 */
export interface ObsidianParams {
  source: string;
  nonce: string;
  redirect: boolean;
  prompt?: 'select_account' | 'consent' | 'none';
}

/**
 * Response from Azure Easy Auth login endpoint
 */
export interface EasyAuthLoginResponse {
  authenticationToken: string;
  user: {
    userId: string;
  };
}

/**
 * Response from bridge API
 */
export interface BridgeApiResponse {
  success: boolean;
  address?: string;
  salt?: string;
  message?: string;
}

/**
 * Google credential response from Identity Services
 */
export interface GoogleCredentialResponse {
  credential: string;  // JWT ID token
  select_by: string;
  clientId?: string;
}

// Legacy types for backwards compatibility
export type BridgeLoginResponse = BridgeApiResponse;

export interface BridgeErrorResponse {
  success: false;
  error: string;
  message: string;
}
