import { useEffect, useState } from 'react';
import { CONFIG } from './config';
import { bridgeService } from './services/BridgeService';
import type { BridgeState } from './types';

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
    const redirectUrl = `${window.location.origin}/auth/callback`;

    const clientId = CONFIG.googleClientId;
    const scope = 'openid email profile';
    const responseType = 'id_token';

    // Construct Auth URL
    let authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUrl)}&` +
      `response_type=${responseType}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `nonce=${nonce || ''}`;

    if (params.get('prompt')) {
       authUrl += `&prompt=${params.get('prompt')}`;
    } else {
       authUrl += `&prompt=select_account`;
    }

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
    <div className="container">
      <div className="card">
        <h1>Enoki Bridge</h1>
        
        {state.status === 'error' && (
          <div className="error-box">
            <h3>Error</h3>
            <p>{state.message}</p>
            <p className="error-detail">{state.error}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}

        {state.status === 'ingest' && state.data?.jwt && (
          // data.jwt holds authUrl here
          <button 
            className="btn-primary"
            onClick={() => window.location.href = state.data!.jwt}
          >
            Log in with Google to connect your oclp wallet
          </button>
        )}

        {(state.status === 'hydrating' || state.status === 'authenticating' || state.status === 'ejecting') && (
          <div>
            <div className="loader"></div>
            <p className="status-message">
              {state.status === 'hydrating' && 'Verifying credentials...'}
              {state.status === 'authenticating' && 'Redirecting to login...'}
              {state.status === 'ejecting' && 'Opening Obsidian...'}
            </p>
          </div>
        )}

        {state.status === 'success' && state.data && (
          <div>
            <p className="status-message">{state.message}</p>
            <a 
              href={`obsidian://enoki-auth?jwt=${encodeURIComponent(state.data.jwt)}&salt=${encodeURIComponent(state.data.salt)}&address=${encodeURIComponent(state.data.address)}`}
              className="btn-primary"
              style={{ display: 'inline-block' }}
            >
              Open Obsidian
            </a>
            <p className="helper-text" style={{ marginTop: 'var(--spacing-md)' }}>
              You may close this tab after Obsidian opens.
            </p>
          </div>
        )}
        
        {state.status === 'idle' && (
          <p>This page is used to bridge authentication for Obsidian. Please initiate login from the Obsidian plugin.</p>
        )}
      </div>
    </div>
  );
}

export default App;
