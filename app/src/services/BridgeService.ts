/**
 * Bridge Service
 * 
 * Handles communication with the Backend for hydration.
 * Uses Azure Easy Auth client-directed flow:
 * 1. POST Google ID token to /.auth/login/google
 * 2. Receive Azure session token (authenticationToken)
 * 3. Use X-ZUMO-AUTH header for subsequent API calls
 */

import { CONFIG } from '../config';
import type { 
  EasyAuthLoginResponse, 
  BridgeApiResponse,
  AuthenticationResult,
  BridgeErrorResponse,
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

    console.log('[BridgeService] Hydrating user data from bridge API...', {
      url,
      hasFuncKey: !!CONFIG.funcKey,
    });

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-ZUMO-AUTH': azureSessionToken,
    };

    // Add function key if configured
    if (CONFIG.funcKey) {
      headers['x-functions-key'] = CONFIG.funcKey;
      console.log('[BridgeService] Added x-functions-key header');
    } else {
      console.warn('[BridgeService] No funcKey in CONFIG - request will likely fail');
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
        const errorData = await response.json() as BridgeErrorResponse;
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
