/**
 * Deeplink Utilities
 * 
 * Handles construction of Obsidian deeplinks and parsing of
 * incoming URL parameters from the Obsidian plugin.
 */

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
