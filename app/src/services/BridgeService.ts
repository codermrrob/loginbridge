/**
 * Bridge Service
 * 
 * Handles communication with the Backend for hydration
 */

import { CONFIG } from '../config.ts';
import type { BridgeLoginResponse, BridgeErrorResponse } from '../types.ts';

export class BridgeService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = CONFIG.backendUrl.replace(/\/$/, '');
  }

  /**
   * Authenticate with backend and hydrate salt
   */
  async authenticateAndHydrate(idToken: string): Promise<{ address: string; salt: string }> {
    const url = `${this.baseUrl}/api/auth/bridge`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google', // Hardcoded to google for this requirement, or pass as arg
          idToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as BridgeErrorResponse;
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json() as BridgeLoginResponse;

      if (!data.success || !data.address || !data.salt) {
        throw new Error(data.message || 'Invalid response from bridge service');
      }

      return {
        address: data.address,
        salt: data.salt,
      };
    } catch (error) {
      console.error('Bridge hydration failed:', error);
      throw error;
    }
  }
}

export const bridgeService = new BridgeService();
