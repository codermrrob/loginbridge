/**
 * Bridge Application Types
 */

export interface BridgeLoginResponse {
  address: string;
  salt?: string;
  success: boolean;
  message?: string;
}

export interface BridgeErrorResponse {
  success: false;
  error: string;
  message: string;
}

export type BridgeStatus = 
  | 'idle'
  | 'ingest'
  | 'authenticating' 
  | 'hydrating' 
  | 'ejecting' 
  | 'error' 
  | 'success';

export interface BridgeState {
  status: BridgeStatus;
  message: string;
  error?: string;
  data?: {
    jwt: string;
    salt: string;
    address: string;
  };
}
