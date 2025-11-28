import { useEffect, useState } from 'react';
import { EnokiClient } from '@mysten/enoki';
import { CONFIG } from './config';
import { bridgeService } from './services/BridgeService';
import type { BridgeState } from './types';

// Enoki Client for Initial Redirect URL generation
// We use it only to generate the auth URL, hydration happens via backend
const enokiClient = new EnokiClient({
  apiKey: CONFIG.enokiApiKey,
});

function App() {
  const [state, setState] = useState<BridgeState>({
    status: 'idle',
    message: 'Initializing Bridge...',
  });

  useEffect(() => {
    const init = async () => {
      try {
        // 1. Check for Callback (Hash)
        const hash = window.location.hash;
        if (hash && hash.includes('id_token=')) {
          await handleCallback(hash);
          return;
        }

        // 2. Check for Ingest (Query Params)
        const params = new URLSearchParams(window.location.search);
        const source = params.get('source');
        
        if (source === 'obsidian') {
          handleIngest(params);
        } else {
          setState({
            status: 'idle',
            message: 'Enoki Bridge: Waiting for Obsidian connection...',
          });
        }
      } catch (err) {
        setState({
          status: 'error',
          message: 'Initialization failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    init();
  }, []);

  const handleIngest = async (params: URLSearchParams) => {
    const provider = params.get('provider') || 'google';
    const redirect = params.get('redirect') === 'true';
    // Critical: Capture nonce if provided by Obsidian (required for zkLogin signing)
    const nonce = params.get('nonce');

    setState({
      status: 'ingest',
      message: 'Preparing to authenticate with Obsidian...',
    });

    // Persist source flag
    sessionStorage.setItem('bridge_source', 'obsidian');

    // Generate Auth URL Manually
    const protocol = window.location.protocol;
    const host = window.location.host;
    const redirectUrl = `${protocol}//${host}`; // Must be whitelisted

    // Base Google OIDC URL
    const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const searchParams = new URLSearchParams({
      client_id: CONFIG.googleClientId,
      redirect_uri: redirectUrl,
      response_type: 'id_token',
      scope: 'openid email profile',
      state: nonce ? `nonce=${nonce}` : '', // Pass nonce in state or nonce param? 
      // Google supports 'nonce' parameter directly for OIDC
      nonce: nonce || '',
      prompt: 'select_account',
    });

    // Remove empty nonce if not present to avoid errors
    if (!nonce) searchParams.delete('nonce');

    const authUrl = `${baseUrl}?${searchParams.toString()}`;

    if (redirect) {
      setState({ status: 'authenticating', message: 'Redirecting to provider...' });
      window.location.href = authUrl;
    } else {
      setState({ 
        status: 'ingest', 
        message: 'Ready to connect', 
        // Store authUrl to use in button
        data: { jwt: authUrl, salt: '', address: '' } 
      });
    }
  };

  const handleCallback = async (hash: string) => {
    // Verify source
    const source = sessionStorage.getItem('bridge_source');
    if (source !== 'obsidian') {
      console.warn('Bridge source not found in session storage');
      // We proceed but might warn user? Or strict security?
      // Strict: return;
    }

    setState({ status: 'hydrating', message: 'Verifying authentication...' });

    // Parse ID Token
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const idToken = params.get('id_token');

    if (!idToken) {
      throw new Error('No ID Token found in URL');
    }

    // Clear Hash (Security)
    window.history.replaceState(null, '', window.location.pathname);

    try {
      // Hydrate via Backend
      const { address, salt } = await bridgeService.authenticateAndHydrate(idToken);

      setState({
        status: 'ejecting',
        message: 'Authentication successful. Opening Obsidian...',
        data: { jwt: idToken, salt, address },
      });

      // Construct Deep Link
      // obsidian://enoki-auth?jwt=...&salt=...&address=...
      const deepLink = `obsidian://enoki-auth?jwt=${encodeURIComponent(idToken)}&salt=${encodeURIComponent(salt)}&address=${encodeURIComponent(address)}`;
      
      // Eject
      window.location.href = deepLink;

      // Show manual link after delay
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          status: 'success',
          message: 'If Obsidian did not open, click the button below.',
        }));
      }, 1500);

    } catch (err) {
      setState({
        status: 'error',
        message: 'Authentication verification failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh', 
      fontFamily: 'sans-serif',
      gap: '20px',
      padding: '20px',
      textAlign: 'center'
    }}>
      <h1>Enoki Bridge</h1>
      
      {state.status === 'error' && (
        <div style={{ color: 'red', maxWidth: '400px' }}>
          <h3>Error</h3>
          <p>{state.message}</p>
          <p style={{ fontSize: '0.8em' }}>{state.error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {state.status === 'ingest' && state.data?.jwt && (
        // data.jwt holds authUrl here
        <button 
          onClick={() => window.location.href = state.data!.jwt}
          style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer' }}
        >
          Log in with Google to Connect Obsidian
        </button>
      )}

      {state.status === 'hydrating' && <p>Verifying credentials...</p>}
      {state.status === 'authenticating' && <p>Redirecting to login...</p>}
      {state.status === 'ejecting' && <p>Opening Obsidian...</p>}

      {state.status === 'success' && state.data && (
        <div>
          <p>{state.message}</p>
          <a 
            href={`obsidian://enoki-auth?jwt=${encodeURIComponent(state.data.jwt)}&salt=${encodeURIComponent(state.data.salt)}&address=${encodeURIComponent(state.data.address)}`}
            style={{ 
              display: 'inline-block', 
              padding: '10px 20px', 
              background: '#0070f3', 
              color: 'white', 
              textDecoration: 'none', 
              borderRadius: '5px' 
            }}
          >
            Open Obsidian
          </a>
          <p style={{ marginTop: '20px', fontSize: '0.8em', color: '#666' }}>
            You may close this tab after Obsidian opens.
          </p>
        </div>
      )}
      
      {state.status === 'idle' && (
        <p>This page is used to bridge authentication for Obsidian. Please initiate login from the Obsidian plugin.</p>
      )}
    </div>
  );
}

export default App;
