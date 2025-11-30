# Developer Specification: Login Bridge Migration to Client-Directed Flow

## 1. Executive Summary

### 1.1 Purpose

Migrate the existing Enoki Login Bridge SPA from server-directed OAuth flow to a client-directed flow that:

1. Accepts a zkLogin nonce from the Obsidian plugin
2. Performs Google Sign-In with the custom nonce embedded in the JWT
3. Exchanges the Google ID token for an Azure Easy Auth session token
4. Returns all authentication artifacts to Obsidian via deeplink

### 1.2 Current vs Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Obsidian ──► SPA ──► Google OAuth (redirect) ──► SPA ──► Azure Function   │
│     │                    (nonce generated                    │              │
│     │                     by Google)                         │              │
│     │                                                        ▼              │
│     ◄────────────────── Deeplink ◄─────────────────── jwt, salt, address   │
│                                                                             │
│  PROBLEM: Cannot control nonce → JWT invalid for Sui zkLogin                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ TARGET FLOW                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Obsidian ──► SPA?nonce=XXX ──► Google Identity Services (popup/redirect)  │
│     │              │                    │                                   │
│     │              │                    ▼ (JWT with zkLogin nonce)          │
│     │              │              ┌─────────────┐                           │
│     │              │              │ SPA handles │                           │
│     │              │              │  callback   │                           │
│     │              │              └──────┬──────┘                           │
│     │              │                     │                                  │
│     │              │                     ▼                                  │
│     │              │         POST /.auth/login/google                       │
│     │              │              { id_token: JWT }                         │
│     │              │                     │                                  │
│     │              │                     ▼                                  │
│     │              │         Azure Easy Auth validates                      │
│     │              │         Returns: authenticationToken                   │
│     │              │                     │                                  │
│     │              │                     ▼                                  │
│     │              │         POST /api/auth/bridge                          │
│     │              │         X-ZUMO-AUTH: {authenticationToken}             │
│     │              │                     │                                  │
│     │              │                     ▼                                  │
│     │              │         Returns: salt, address                         │
│     │              │                     │                                  │
│     ◄──────────────┴─────── Deeplink ◄───┘                                  │
│                                                                             │
│  obsidian://enoki-auth?jwt=X&azure_token=X&salt=X&address=X                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.3 Flow Descriptions

### Current Flow (Server-Directed)

1. **Initiation**: User triggers wallet connection from the Obsidian plugin. The plugin opens the browser to the Login Bridge SPA, passing `source=obsidian` as a URL parameter.
2. **OAuth Redirect**: The SPA constructs a Google OAuth authorization URL and redirects the user's browser to Google's authentication servers. During this redirect, Google generates its own random nonce value for replay protection.
3. **Google Authentication**: User authenticates with Google (selecting account, entering credentials if needed). Upon success, Google redirects back to the SPA's callback URL with the ID token in the URL hash fragment.
4. **Token Processing**: The SPA extracts the ID token from the URL hash and calls the Azure Function backend (`/api/auth/bridge`) directly, passing the Google JWT. The backend processes this with Enoki to obtain the user's salt and Sui address.
5. **Return to Obsidian**: The SPA constructs a deeplink containing the JWT, salt, and address, then redirects to `obsidian://enoki-auth?jwt=...&salt=...&address=...`. The plugin receives these credentials and stores them.
6. **Problem**: When the plugin later attempts to use the JWT for zkLogin transaction signing, it fails because the JWT's nonce field contains Google's randomly generated value rather than the required hash of the ephemeral public key and max epoch. The ZK proof verification rejects transactions because the nonce doesn't bind the JWT to the ephemeral key pair.

---

### Target Flow (Client-Directed with Custom Nonce)

1. **Ephemeral Key Generation**: User triggers wallet connection from the Obsidian plugin. Before opening the browser, the plugin generates an ephemeral Ed25519 key pair, calculates the max epoch, generates randomness, and computes the zkLogin nonce as `hash(ephemeralPublicKey, maxEpoch, randomness)`. The plugin stores the private key, max epoch, and randomness locally.
2. **Bridge Initiation**: The plugin opens the browser to the Login Bridge SPA, passing `source=obsidian&nonce={zkLoginNonce}` as URL parameters. The nonce contains the cryptographic binding to the ephemeral key.
3. **Google Identity Services Initialization**: The SPA loads the Google Identity Services JavaScript library and initializes it with the zkLogin nonce passed from Obsidian. This nonce will be embedded directly into the JWT that Google issues.
4. **Google Authentication**: The SPA renders the "Sign in with Google" button. User clicks and authenticates via popup (or One Tap). Upon success, Google's library invokes the callback with a credential response containing the ID token. Critically, this JWT now contains the zkLogin nonce in its `nonce` claim field.
5. **Azure Token Exchange**: The SPA performs a client-directed login by POSTing the Google ID token to Azure Easy Auth at `/.auth/login/google`. Azure validates the Google JWT and returns an `authenticationToken` (Azure session token) that can be used to authenticate subsequent API calls.
6. **Bridge API Call**: The SPA calls the backend bridge API (`/api/auth/bridge`) with the `X-ZUMO-AUTH` header containing the Azure session token. The backend processes the Google JWT with Enoki to obtain the user's salt and derive the Sui zkLogin address.
7. **Return to Obsidian**: The SPA constructs a deeplink containing all four credentials: the Google JWT (with embedded zkLogin nonce), the Azure session token, the salt, and the address. It redirects to `obsidian://enoki-auth?jwt=...&azure_token=...&salt=...&address=...`.
8. **Plugin Receives Credentials**: The Obsidian plugin receives the deeplink callback and stores all credentials. The JWT is now valid for zkLogin because its nonce matches the ephemeral key pair the plugin generated. The Azure token enables authenticated calls to protected backend functions.
9. **Transaction Signing**: When the user initiates a transaction, the plugin can now successfully generate ZK proofs because the JWT's nonce correctly binds to the stored ephemeral key pair. The plugin signs transactions with the ephemeral private key and submits them with the ZK proof. For any backend API calls requiring authentication, the plugin includes the `X-ZUMO-AUTH` header with the Azure session token.


---

## 2. Technical Requirements

### 2.1 Input Parameters (from Obsidian)

|Parameter|Type|Required|Description|
|---|---|---|---|
|`source`|string|Yes|Must be `"obsidian"`|
|`nonce`|string|Yes|zkLogin nonce: `hash(ephemeralPublicKey, maxEpoch, randomness)`|
|`redirect`|boolean|No|If `true`, auto-redirect to Google. Default: `false` (show button)|
|`prompt`|string|No|Google prompt behavior: `"select_account"`, `"consent"`, `"none"`|

**Example URL from Obsidian:**

```
https://your-app.azurewebsites.net/?source=obsidian&nonce=abc123xyz&redirect=true
```

### 2.2 Output Parameters (to Obsidian via Deeplink)

|Parameter|Type|Description|
|---|---|---|
|`jwt`|string|Google ID token (contains zkLogin nonce)|
|`azure_token`|string|Azure Easy Auth session token (`authenticationToken`)|
|`salt`|string|Enoki user salt|
|`address`|string|Sui zkLogin address|

**Deeplink Format:**

```
obsidian://enoki-auth?jwt={jwt}&azure_token={azure_token}&salt={salt}&address={address}
```

### 2.3 Security Requirements

1. **Nonce Validation**: The SPA must validate that a nonce is provided before initiating Google Sign-In
2. **Session Storage**: Use `sessionStorage` (not `localStorage`) for temporary state
3. **URL Hash Clearing**: Clear sensitive data from URL immediately after parsing
4. **HTTPS Only**: All communications must use HTTPS
5. **Token Expiry Awareness**: UI should inform users about token validity windows

---

## 3. File Structure

```
src/
├── main.tsx                    # Entry point (minimal changes)
├── App.tsx                     # Main component (major refactor)
├── index.css                   # Styles (no changes)
├── config.ts                   # Configuration (add Google Client ID)
├── types.ts                    # Type definitions (update)
├── services/
│   ├── BridgeService.ts        # Azure API calls (refactor)
│   └── GoogleAuthService.ts    # NEW: Google Identity Services wrapper
└── utils/
    └── deeplink.ts             # NEW: Deeplink construction utilities
```

---

## 4. Detailed Component Specifications

### 4.1 Type Definitions (`types.ts`)

```typescript
// types.ts

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
```

### 4.2 Configuration (`config.ts`)

```typescript
// config.ts

interface Config {
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

export const CONFIG: Config = {
  backendUrl: import.meta.env.VITE_BACKEND_URL || '',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  funcKey: import.meta.env.VITE_FUNC_KEY || undefined,
  deeplinkProtocol: 'obsidian',
  deeplinkCallback: 'enoki-auth',
};

/**
 * Validate required configuration
 */
export function validateConfig(): void {
  if (!CONFIG.backendUrl) {
    throw new Error('VITE_BACKEND_URL environment variable is required');
  }
  if (!CONFIG.googleClientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID environment variable is required');
  }
}
```

### 4.3 Google Auth Service (`services/GoogleAuthService.ts`)

```typescript
// services/GoogleAuthService.ts

import { CONFIG } from '../config';
import type { GoogleCredentialResponse } from '../types';

/**
 * Declares the global google namespace for TypeScript
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void;
          prompt: (callback?: (notification: PromptNotification) => void) => void;
          renderButton: (parent: HTMLElement, options: ButtonOptions) => void;
          cancel: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: 'signin' | 'signup' | 'use';
  ux_mode?: 'popup' | 'redirect';
  login_uri?: string;
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface ButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: string;
  locale?: string;
}

interface PromptNotification {
  isDisplayMoment: () => boolean;
  isDisplayed: () => boolean;
  isNotDisplayed: () => boolean;
  getNotDisplayedReason: () => string;
  isSkippedMoment: () => boolean;
  getSkippedReason: () => string;
  isDismissedMoment: () => boolean;
  getDismissedReason: () => string;
}

/**
 * Service for handling Google Identity Services authentication
 * with support for custom nonce (required for Sui zkLogin)
 */
export class GoogleAuthService {
  private static instance: GoogleAuthService;
  private initialized: boolean = false;
  private scriptLoaded: boolean = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }

  /**
   * Load the Google Identity Services script
   */
  public async loadScript(): Promise<void> {
    if (this.scriptLoaded) {
      return;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.google?.accounts?.id) {
        this.scriptLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.scriptLoaded = true;
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Google Identity Services script'));
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * Initialize Google Identity Services with custom nonce
   * 
   * @param nonce - The zkLogin nonce (hash of ephemeral public key + max epoch)
   * @param callback - Callback function to handle the credential response
   */
  public initialize(
    nonce: string,
    callback: (response: GoogleCredentialResponse) => void
  ): void {
    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services not loaded');
    }

    if (!nonce) {
      throw new Error('Nonce is required for zkLogin authentication');
    }

    window.google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback,
      nonce,  // CRITICAL: This embeds the zkLogin nonce in the JWT
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
      itp_support: true,
      use_fedcm_for_prompt: true,
    });

    this.initialized = true;
  }

  /**
   * Render the Sign In With Google button
   * 
   * @param parentElement - DOM element to render the button into
   * @param options - Button customization options
   */
  public renderButton(
    parentElement: HTMLElement,
    options: Partial<ButtonOptions> = {}
  ): void {
    if (!this.initialized) {
      throw new Error('Google Auth Service not initialized');
    }

    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services not loaded');
    }

    const defaultOptions: ButtonOptions = {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: '300',
    };

    window.google.accounts.id.renderButton(parentElement, {
      ...defaultOptions,
      ...options,
    });
  }

  /**
   * Show the One Tap prompt
   * 
   * @param momentCallback - Optional callback for prompt status notifications
   */
  public prompt(momentCallback?: (notification: PromptNotification) => void): void {
    if (!this.initialized) {
      throw new Error('Google Auth Service not initialized');
    }

    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services not loaded');
    }

    window.google.accounts.id.prompt(momentCallback);
  }

  /**
   * Cancel any ongoing prompt
   */
  public cancel(): void {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.cancel();
    }
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset initialization state (for re-initialization with new nonce)
   */
  public reset(): void {
    this.initialized = false;
  }
}

export const googleAuthService = GoogleAuthService.getInstance();
```

### 4.4 Bridge Service (`services/BridgeService.ts`)

```typescript
// services/BridgeService.ts

import { CONFIG } from '../config';
import type { 
  EasyAuthLoginResponse, 
  BridgeApiResponse,
  AuthenticationResult 
} from '../types';

/**
 * Service for handling Azure Easy Auth and Enoki bridge API calls
 */
export class BridgeService {
  private baseUrl: string;
  private sessionToken: string | null = null;

  constructor() {
    this.baseUrl = CONFIG.backendUrl.replace(/\/$/, '');
  }

  /**
   * Exchange Google ID token for Azure Easy Auth session token
   * 
   * This is the client-directed flow - we POST the Google JWT to Azure
   * and receive an Azure session token in return.
   * 
   * @param googleIdToken - The JWT from Google (containing zkLogin nonce)
   * @returns Azure session token (authenticationToken)
   * @throws Error if exchange fails
   * 
   * @see https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-customize-sign-in-out
   */
  public async exchangeGoogleTokenForAzureSession(
    googleIdToken: string
  ): Promise<string> {
    const url = `${this.baseUrl}/.auth/login/google`;

    console.log('[BridgeService] Exchanging Google token for Azure session...');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id_token: googleIdToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BridgeService] Easy Auth exchange failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(
        `Azure Easy Auth login failed: HTTP ${response.status} - ${response.statusText}`
      );
    }

    const data: EasyAuthLoginResponse = await response.json();

    if (!data.authenticationToken) {
      throw new Error('No authenticationToken in Azure Easy Auth response');
    }

    console.log('[BridgeService] Azure session token obtained successfully');
    this.sessionToken = data.authenticationToken;
    
    return data.authenticationToken;
  }

  /**
   * Call the bridge API to get user salt and address
   * 
   * @param googleIdToken - The Google JWT (for Enoki processing)
   * @param azureSessionToken - The Azure session token for authentication
   * @returns Salt and address from Enoki
   * @throws Error if API call fails
   */
  public async hydrateUserData(
    googleIdToken: string,
    azureSessionToken: string
  ): Promise<{ salt: string; address: string }> {
    const url = `${this.baseUrl}/api/auth/bridge`;

    console.log('[BridgeService] Hydrating user data from bridge API...');

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-ZUMO-AUTH': azureSessionToken,
    };

    // Add function key if configured
    if (CONFIG.funcKey) {
      headers['x-functions-key'] = CONFIG.funcKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: 'google',
        idToken: googleIdToken,
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      let errorMessage = `HTTP ${response.status}`;

      if (contentType.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } else {
        const errorText = await response.text();
        console.error('[BridgeService] Non-JSON error response:', errorText);
        errorMessage = `${errorMessage}: ${errorText.slice(0, 200)}`;
      }

      throw new Error(errorMessage);
    }

    const data: BridgeApiResponse = await response.json();

    if (!data.success || !data.address || !data.salt) {
      throw new Error(
        data.message || 'Invalid response from bridge service'
      );
    }

    console.log('[BridgeService] User data hydrated successfully');

    return {
      address: data.address,
      salt: data.salt,
    };
  }

  /**
   * Complete authentication flow: Exchange token + Hydrate data
   * 
   * @param googleIdToken - The Google JWT from Identity Services
   * @returns Complete authentication result for Obsidian
   */
  public async completeAuthentication(
    googleIdToken: string
  ): Promise<AuthenticationResult> {
    // Step 1: Exchange Google token for Azure session
    const azureToken = await this.exchangeGoogleTokenForAzureSession(
      googleIdToken
    );

    // Step 2: Hydrate user data (salt + address)
    const { salt, address } = await this.hydrateUserData(
      googleIdToken,
      azureToken
    );

    return {
      jwt: googleIdToken,
      azureToken,
      salt,
      address,
    };
  }

  /**
   * Get the current Azure session token (if available)
   */
  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Clear stored session token
   */
  public clearSession(): void {
    this.sessionToken = null;
  }
}

export const bridgeService = new BridgeService();
```

### 4.5 Deeplink Utilities (`utils/deeplink.ts`)

```typescript
// utils/deeplink.ts

import { CONFIG } from '../config';
import type { AuthenticationResult } from '../types';

/**
 * Construct the Obsidian deeplink URL with all authentication data
 * 
 * @param data - Complete authentication result
 * @returns Formatted deeplink URL
 */
export function buildDeeplink(data: AuthenticationResult): string {
  const params = new URLSearchParams({
    jwt: data.jwt,
    azure_token: data.azureToken,
    salt: data.salt,
    address: data.address,
  });

  return `${CONFIG.deeplinkProtocol}://${CONFIG.deeplinkCallback}?${params.toString()}`;
}

/**
 * Attempt to open Obsidian via deeplink
 * 
 * @param data - Authentication data to pass to Obsidian
 * @returns The deeplink URL that was opened
 */
export function ejectToObsidian(data: AuthenticationResult): string {
  const deeplink = buildDeeplink(data);
  
  console.log('[Deeplink] Ejecting to Obsidian:', deeplink.substring(0, 100) + '...');
  
  window.location.href = deeplink;
  
  return deeplink;
}

/**
 * Parse incoming URL parameters from Obsidian
 * 
 * @param searchParams - URL search parameters
 * @returns Parsed parameters or null if invalid
 */
export function parseObsidianParams(
  searchParams: URLSearchParams
): { 
  nonce: string; 
  redirect: boolean; 
  prompt?: string;
} | null {
  const source = searchParams.get('source');
  const nonce = searchParams.get('nonce');

  // Validate required parameters
  if (source !== 'obsidian') {
    console.log('[Deeplink] Source is not obsidian:', source);
    return null;
  }

  if (!nonce) {
    console.error('[Deeplink] Missing required nonce parameter');
    return null;
  }

  return {
    nonce,
    redirect: searchParams.get('redirect') === 'true',
    prompt: searchParams.get('prompt') || undefined,
  };
}

/**
 * Clear sensitive data from URL (hash and search params)
 */
export function clearUrlSensitiveData(): void {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState(null, '', cleanUrl);
}
```

### 4.6 Main App Component (`App.tsx`)

```typescript
// App.tsx

import { useEffect, useState, useRef, useCallback } from 'react';
import { validateConfig } from './config';
import { googleAuthService } from './services/GoogleAuthService';
import { bridgeService } from './services/BridgeService';
import { 
  parseObsidianParams, 
  ejectToObsidian, 
  clearUrlSensitiveData,
  buildDeeplink 
} from './utils/deeplink';
import type { 
  BridgeState, 
  AuthenticationResult,
  GoogleCredentialResponse 
} from './types';

// Session storage keys
const STORAGE_KEYS = {
  SOURCE: 'bridge_source',
  NONCE: 'bridge_nonce',
} as const;

function App() {
  const [state, setState] = useState<BridgeState>({
    status: 'idle',
    message: 'Initializing Bridge...',
  });

  // Ref for the Google Sign-In button container
  const buttonContainerRef = useRef<HTMLDivElement>(null);

  // Store nonce for use in callback
  const nonceRef = useRef<string | null>(null);

  /**
   * Handle successful Google credential response
   */
  const handleGoogleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      console.log('[App] Received Google credential');

      if (!response.credential) {
        setState({
          status: 'error',
          message: 'Authentication failed',
          error: 'No credential received from Google',
        });
        return;
      }

      try {
        // Update state to show progress
        setState({
          status: 'exchanging',
          message: 'Exchanging credentials with Azure...',
        });

        // Complete the full authentication flow
        const authResult = await bridgeService.completeAuthentication(
          response.credential
        );

        setState({
          status: 'ejecting',
          message: 'Authentication successful. Opening Obsidian...',
          data: authResult,
        });

        // Eject to Obsidian
        ejectToObsidian(authResult);

        // Show manual link after delay (in case deeplink doesn't work)
        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            status: 'success',
            message: 'If Obsidian did not open, click the button below.',
          }));
        }, 2000);

      } catch (err) {
        console.error('[App] Authentication flow failed:', err);
        setState({
          status: 'error',
          message: 'Authentication failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    []
  );

  /**
   * Initialize Google Sign-In with the provided nonce
   */
  const initializeGoogleSignIn = useCallback(
    async (nonce: string, autoPrompt: boolean = false) => {
      try {
        setState({
          status: 'initializing',
          message: 'Loading Google Sign-In...',
        });

        // Store nonce for later use
        nonceRef.current = nonce;
        sessionStorage.setItem(STORAGE_KEYS.NONCE, nonce);

        // Load the Google Identity Services script
        await googleAuthService.loadScript();

        // Initialize with our zkLogin nonce
        googleAuthService.initialize(nonce, handleGoogleCredential);

        setState({
          status: 'ready',
          message: 'Click the button below to sign in with Google',
        });

        // Render the button if container exists
        if (buttonContainerRef.current) {
          // Clear any existing button
          buttonContainerRef.current.innerHTML = '';
          
          googleAuthService.renderButton(buttonContainerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: '300',
          });
        }

        // Optionally show the One Tap prompt
        if (autoPrompt) {
          googleAuthService.prompt((notification) => {
            if (notification.isNotDisplayed()) {
              console.log(
                '[App] One Tap not displayed:',
                notification.getNotDisplayedReason()
              );
            }
            if (notification.isSkippedMoment()) {
              console.log(
                '[App] One Tap skipped:',
                notification.getSkippedReason()
              );
            }
          });
        }

      } catch (err) {
        console.error('[App] Failed to initialize Google Sign-In:', err);
        setState({
          status: 'error',
          message: 'Failed to initialize authentication',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [handleGoogleCredential]
  );

  /**
   * Main initialization effect
   */
  useEffect(() => {
    const init = async () => {
      try {
        // Validate configuration first
        validateConfig();

        // Parse URL parameters
        const params = new URLSearchParams(window.location.search);
        const obsidianParams = parseObsidianParams(params);

        if (obsidianParams) {
          // Store source in session storage
          sessionStorage.setItem(STORAGE_KEYS.SOURCE, 'obsidian');

          // Clear URL parameters for security
          clearUrlSensitiveData();

          // Initialize Google Sign-In with the zkLogin nonce
          await initializeGoogleSignIn(
            obsidianParams.nonce,
            obsidianParams.redirect
          );

        } else {
          // No valid Obsidian parameters - show idle state
          setState({
            status: 'idle',
            message: 
              'This page bridges authentication for Obsidian. ' +
              'Please initiate login from the Obsidian plugin.',
          });
        }

      } catch (err) {
        console.error('[App] Initialization error:', err);
        setState({
          status: 'error',
          message: 'Initialization failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    init();

    // Cleanup
    return () => {
      googleAuthService.cancel();
    };
  }, [initializeGoogleSignIn]);

  /**
   * Render the manual Obsidian link button
   */
  const renderManualLink = () => {
    if (!state.data?.jwt || !state.data?.azureToken || 
        !state.data?.salt || !state.data?.address) {
      return null;
    }

    const deeplink = buildDeeplink(state.data as AuthenticationResult);

    return (
      
        href={deeplink}
        className="btn-primary"
        style={{ display: 'inline-block', marginTop: 'var(--spacing-md)' }}
      >
        Open Obsidian
      </a>
    );
  };

  return (
    <div className="container">
      <div className="card">
        <h1>Enoki Bridge</h1>

        {/* Error State */}
        {state.status === 'error' && (
          <div className="error-box">
            <h3>Error</h3>
            <p>{state.message}</p>
            {state.error && <p className="error-detail">{state.error}</p>}
            <button
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        )}

        {/* Idle State */}
        {state.status === 'idle' && (
          <div>
            <p>{state.message}</p>
            <p className="helper-text">
              Waiting for connection from Obsidian plugin...
            </p>
          </div>
        )}

        {/* Initializing State */}
        {state.status === 'initializing' && (
          <div>
            <div className="loader"></div>
            <p className="status-message">{state.message}</p>
          </div>
        )}

        {/* Ready State - Show Google Sign-In Button */}
        {state.status === 'ready' && (
          <div>
            <p className="status-message">{state.message}</p>
            <div
              ref={buttonContainerRef}
              className="google-signin-container"
              style={{ 
                display: 'flex', 
                justifyContent: 'center',
                marginTop: 'var(--spacing-lg)',
                minHeight: '50px',
              }}
            />
            <p className="helper-text" style={{ marginTop: 'var(--spacing-md)' }}>
              Sign in to connect your wallet
            </p>
          </div>
        )}

        {/* Processing States */}
        {(state.status === 'authenticating' ||
          state.status === 'exchanging' ||
          state.status === 'hydrating' ||
          state.status === 'ejecting') && (
          <div>
            <div className="loader"></div>
            <p className="status-message">
              {state.status === 'authenticating' && 'Authenticating with Google...'}
              {state.status === 'exchanging' && 'Securing session with Azure...'}
              {state.status === 'hydrating' && 'Retrieving wallet data...'}
              {state.status === 'ejecting' && 'Opening Obsidian...'}
            </p>
          </div>
        )}

        {/* Success State */}
        {state.status === 'success' && state.data && (
          <div>
            <div className="success-icon">✓</div>
            <p className="status-message">{state.message}</p>
            {renderManualLink()}
            <p className="helper-text" style={{ marginTop: 'var(--spacing-md)' }}>
              You may close this tab after Obsidian opens.
            </p>
          </div>
        )}
      </div>

      {/* Debug info (only in development) */}
      {import.meta.env.DEV && (
        <div className="debug-panel" style={{ marginTop: '2rem', opacity: 0.7 }}>
          <small>
            Status: {state.status} | 
            Nonce: {nonceRef.current?.substring(0, 20)}...
          </small>
        </div>
      )}
    </div>
  );
}

export default App;
```

### 4.7 Entry Point (`main.tsx`)

```typescript
// main.tsx
// No changes required from original

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## 5. Environment Configuration

### 5.1 Environment Variables (`.env`)

```bash
# .env.local (development)
VITE_BACKEND_URL=https://your-function-app.azurewebsites.net
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_FUNC_KEY=your-azure-function-key  # Optional

# .env.production
VITE_BACKEND_URL=https://your-production-app.azurewebsites.net
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 5.2 Azure Configuration Requirements

#### 5.2.1 App Service Authentication Settings

In Azure Portal → Your Function App → Authentication:

1. **Identity Provider**: Add Google
    - Client ID: Your Google OAuth Client ID
    - Client Secret: Your Google OAuth Client Secret
2. **Authentication Settings**:
    - Restrict Access: **Allow unauthenticated requests**
    - Token Store: **Enabled**
    - Unauthenticated Requests: **Allow Anonymous (important!)**
3. **Allowed External Redirect URLs**:
    - Add your SPA URL(s) if needed

#### 5.2.2 CORS Settings

```json
{
  "allowedOrigins": [
    "https://your-spa-domain.com",
    "http://localhost:5173"
  ],
  "supportCredentials": true
}
```

### 5.3 Google Cloud Console Configuration

1. **OAuth 2.0 Client ID** (Web application):
    - Authorized JavaScript origins:
        - `https://your-spa-domain.com`
        - `http://localhost:5173` (development)
    - Authorized redirect URIs:
        - `https://your-spa-domain.com` (for popup flow, same origin)
2. **OAuth Consent Screen**:
    - Scopes: `openid`, `email`, `profile`

---

## 6. Obsidian Plugin Updates

The Obsidian plugin will need to be updated to:

1. **Generate the zkLogin nonce** before opening the browser
2. **Pass the nonce** in the URL parameters
3. **Handle the new `azure_token`** parameter in the deeplink callback

### 6.1 Example Plugin Code Changes

```typescript
// In Obsidian plugin

import { generateNonce, generateRandomness } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

async function initiateLogin() {
  // 1. Generate ephemeral key pair
  const ephemeralKeyPair = new Ed25519Keypair();
  
  // 2. Calculate max epoch (e.g., current + 2)
  const { epoch } = await suiClient.getLatestSuiSystemState();
  const maxEpoch = Number(epoch) + 2;
  
  // 3. Generate randomness
  const randomness = generateRandomness();
  
  // 4. Generate zkLogin nonce
  const nonce = generateNonce(
    ephemeralKeyPair.getPublicKey(), 
    maxEpoch, 
    randomness
  );
  
  // 5. Store ephemeral key pair and randomness for later
  await this.storeEphemeralData({
    privateKey: ephemeralKeyPair.export().privateKey,
    maxEpoch,
    randomness,
  });
  
  // 6. Open browser with nonce
  const bridgeUrl = new URL('https://your-bridge.azurewebsites.net/');
  bridgeUrl.searchParams.set('source', 'obsidian');
  bridgeUrl.searchParams.set('nonce', nonce);
  bridgeUrl.searchParams.set('redirect', 'true');
  
  window.open(bridgeUrl.toString());
}

// Handle deeplink callback
function handleEnokiAuthCallback(params: URLSearchParams) {
  const jwt = params.get('jwt');
  const azureToken = params.get('azure_token');  // NEW!
  const salt = params.get('salt');
  const address = params.get('address');
  
  if (!jwt || !azureToken || !salt || !address) {
    throw new Error('Missing required authentication parameters');
  }
  
  // Store all credentials
  this.credentials = {
    jwt,
    azureToken,  // Store for API calls
    salt,
    address,
  };
  
  // Now ready to make authenticated API calls
  // Use X-ZUMO-AUTH header with azureToken
}

// Example API call using the Azure token
async function callProtectedApi(endpoint: string, data: any) {
  const response = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ZUMO-AUTH': this.credentials.azureToken,  // Use Azure token
    },
    body: JSON.stringify(data),
  });
  
  return response.json();
}
```

---

## 7. Error Handling Matrix

|Error Scenario|Detection|User Message|Recovery Action|
|---|---|---|---|
|Missing nonce parameter|URL parse returns null|"Missing authentication data. Please try again from Obsidian."|Show retry button → redirect to Obsidian|
|Google script load failure|Script onError event|"Failed to load Google Sign-In. Check your connection."|Retry button|
|Google sign-in cancelled|No credential in response|"Sign-in was cancelled. Please try again."|Show sign-in button again|
|Azure Easy Auth failure|HTTP 401/403 from /.auth/login|"Azure authentication failed. Please contact support."|Show error details + retry|
|Bridge API failure|HTTP error from /api/auth/bridge|"Wallet connection failed: {error}"|Retry button|
|Deeplink failure|Manual detection via timeout|"If Obsidian did not open, click below."|Show manual link button|
|Network error|Fetch throws|"Network error. Check your connection."|Retry button|

---

## 8. Testing Plan

### 8.1 Removed intentionally

### 8.2 Integration Test Checklist

- [ ]  **Happy Path**: Full flow from Obsidian → Google Sign-In → Azure → Back to Obsidian
- [ ]  **Nonce Validation**: Verify JWT contains correct nonce claim
- [ ]  **Token Exchange**: Verify Azure accepts Google JWT and returns session token
- [ ]  **API Protection**: Verify protected endpoints reject requests without X-ZUMO-AUTH
- [ ]  **Deeplink**: Verify all parameters arrive correctly in Obsidian
- [ ]  **Error Recovery**: Test each error scenario and recovery path
- [ ]  **Session Expiry**: Test behavior when Azure token expires

### 8.3 Manual Testing Steps

1. Generate a test nonce using Sui SDK
2. Navigate to `https://bridge-url/?source=obsidian&nonce={test-nonce}`
3. Click Google Sign-In button
4. Complete Google authentication
5. Observe state transitions in UI
6. Verify Obsidian opens with all parameters
7. In Obsidian, verify all credentials are received
8. Make a test API call using the Azure token

---

## 9. Migration Checklist

### 9.1 Code Changes

- [ ]  Create `types.ts` with updated type definitions
- [ ]  Update `config.ts` with Google Client ID
- [ ]  Create `services/GoogleAuthService.ts`
- [ ]  Refactor `services/BridgeService.ts`
- [ ]  Create `utils/deeplink.ts`
- [ ]  Refactor `App.tsx`
- [ ]  Update `.env` files
- [ ]  Add Google Identity Services script handling

### 9.2 Infrastructure Changes

- [ ]  Configure Google OAuth Client in Google Cloud Console
- [ ]  Configure Azure Easy Auth with Google provider
- [ ]  Set CORS policies on Azure Function App
- [ ]  Configure allowed redirect URIs
- [ ]  Test unauthenticated access to static SPA files

### 9.3 Obsidian Plugin Changes

- [ ]  Update to pass `nonce` parameter
- [ ]  Handle new `azure_token` in deeplink callback
- [ ]  Store Azure token for API calls
- [ ]  Update API call headers to use `X-ZUMO-AUTH`


---

## 10. Security Considerations

1. **Nonce Integrity**: The zkLogin nonce MUST be generated by the Obsidian plugin using the ephemeral key pair. Never generate it in the SPA.
2. **Session Storage**: Use `sessionStorage` instead of `localStorage` for temporary authentication state to prevent persistence across sessions.
3. **URL Sanitization**: Clear sensitive parameters from URL immediately after parsing.
4. **Token Transmission**: All tokens are transmitted via HTTPS deeplink, which is handled by the OS securely.
5. **Azure Token Scope**: The Azure session token only authenticates the user to your Azure Functions. It cannot be used to access other Azure resources.
6. **JWT Expiry**: Google JWTs expire in 1 hour. The Obsidian plugin should handle re-authentication when needed.
7. **CORS**: Ensure CORS is properly configured to only allow requests from your SPA domain.


