import { useEffect, useState, useRef, useCallback } from 'react';
import { validateConfig } from './config';
import { getAuthProvider, type AuthProvider, type CredentialResponse, type AuthProviderType } from './services/auth';
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
} from './types';

// Session storage keys
const STORAGE_KEYS = {
  SOURCE: 'bridge_source',
  NONCE: 'bridge_nonce',
  PROVIDER: 'bridge_provider',
} as const;

function App() {
  const [state, setState] = useState<BridgeState>({
    status: 'idle',
    message: 'Initializing Bridge...',
  });

  // Ref for the sign-in button container
  const buttonContainerRef = useRef<HTMLDivElement>(null);

  // Store nonce and provider for use in callback
  const nonceRef = useRef<string | null>(null);
  const providerRef = useRef<AuthProviderType>('google');
  const authProviderRef = useRef<AuthProvider | null>(null);

  /**
   * Handle successful credential response from any provider
   */
  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      console.log(`[App] Received ${response.provider} credential`);

      if (!response.credential) {
        setState({
          status: 'error',
          message: 'Authentication failed',
          error: `No credential received from ${response.provider}`,
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
          response.provider,
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
   * Initialize auth provider with the provided nonce
   */
  const initializeAuth = useCallback(
    async (nonce: string, provider: AuthProviderType) => {
      try {
        const providerName = provider === 'google' ? 'Google' : 'Twitch';
        setState({
          status: 'initializing',
          message: `Loading ${providerName} Sign-In...`,
        });

        // Store nonce and provider for later use
        nonceRef.current = nonce;
        providerRef.current = provider;
        sessionStorage.setItem(STORAGE_KEYS.NONCE, nonce);
        sessionStorage.setItem(STORAGE_KEYS.PROVIDER, provider);

        // Get the appropriate auth provider
        const authProvider = getAuthProvider(provider);
        authProviderRef.current = authProvider;

        // Load any required scripts
        await authProvider.loadScript();

        // Initialize with our zkLogin nonce
        authProvider.initialize(nonce, handleCredential);

        // Set ready state - button will be rendered by useEffect below
        setState({
          status: 'ready',
          message: `Click the button below to sign in with ${providerName}`,
        });

      } catch (err) {
        console.error('[App] Failed to initialize auth:', err);
        setState({
          status: 'error',
          message: 'Failed to initialize authentication',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [handleCredential]
  );

  /**
   * Render auth button when ready and container is mounted
   */
  useEffect(() => {
    if (state.status === 'ready' && buttonContainerRef.current && authProviderRef.current) {
      buttonContainerRef.current.innerHTML = '';
      authProviderRef.current.renderButton(buttonContainerRef.current);
    }
  }, [state.status]);

  /**
   * Main initialization effect
   */
  useEffect(() => {
    const init = async () => {
      try {
        // Validate configuration first
        validateConfig();

        // Check for Twitch callback first (returns via hash fragment)
        const hash = window.location.hash;
        if (hash.includes('id_token=') || hash.includes('error=')) {
          // This is a Twitch callback - restore provider from session
          const storedProvider = sessionStorage.getItem(STORAGE_KEYS.PROVIDER) as AuthProviderType || 'twitch';
          const storedNonce = sessionStorage.getItem(STORAGE_KEYS.NONCE);
          
          if (storedNonce) {
            console.log('[App] Detected Twitch callback, restoring session');
            await initializeAuth(storedNonce, storedProvider);
            return;
          }
        }

        // Parse URL parameters
        const params = new URLSearchParams(window.location.search);
        const obsidianParams = parseObsidianParams(params);

        if (obsidianParams) {
          // Store source in session storage
          sessionStorage.setItem(STORAGE_KEYS.SOURCE, 'obsidian');

          // Clear URL parameters for security (but not hash - Twitch needs it)
          clearUrlSensitiveData();

          // Initialize auth with the zkLogin nonce and selected provider
          await initializeAuth(obsidianParams.nonce, obsidianParams.provider);

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
      if (authProviderRef.current) {
        authProviderRef.current.cancel();
      }
    };
  }, [initializeAuth]);

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
      <a
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
            <h3>Configuration Error</h3>
            <p>{state.message}</p>
            {state.error && <p className="error-detail">{state.error}</p>}
            <p className="helper-text" style={{ marginTop: 'var(--spacing-md)' }}>
              Please close this window and try again from the Obsidian plugin.
            </p>
            <button
              className="btn-primary"
              onClick={() => window.close()}
            >
              OK
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

        {/* Ready State - Show Sign-In Button */}
        {state.status === 'ready' && (
          <div>
            <p className="status-message">{state.message}</p>
            <div
              ref={buttonContainerRef}
              className="signin-container"
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
              {state.status === 'authenticating' && `Authenticating with ${providerRef.current === 'google' ? 'Google' : 'Twitch'}...`}
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
            Provider: {providerRef.current} |
            Nonce: {nonceRef.current?.substring(0, 20)}...
          </small>
        </div>
      )}
    </div>
  );
}

export default App;
