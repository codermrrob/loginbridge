# Secure SPA Authentication Flow

## Developer Specification

---

## 1. Overview

This document specifies a secure method for deploying a login Single Page Application (SPA) to a public GitHub repository while protecting sensitive configuration values from exposure.

### 1.1 Problem Statement

The SPA requires access to sensitive configuration values:

- OAuth Provider Client IDs (Google, Twitch, etc.)
- Backend Server URL
- Enoki Public API Key
- Backend API Secret Key (Function Key)

These values cannot be committed to a public repository but must be available to the SPA at runtime.

### 1.2 Solution Summary

The desktop application passes secrets to the SPA via URL hash fragments at launch time. The SPA reads these values client-side after loading, then uses them to communicate with the backend server.

---

## 2. Architecture

### 2.1 System Components

| Component | Description | Hosts Secrets |
|-----------|-------------|---------------|
| Desktop App | Native application that launches the SPA | ✅ Yes (secure storage) |
| GitHub Pages | Static file hosting for the SPA | ❌ No |
| SPA | Browser-based login interface | ⚡ Runtime only (in memory) |
| Backend Server | API server requiring authentication | ✅ Yes (validates secrets) |

### 2.2 Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              DESKTOP APP                                 │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Secure Storage (OS Keychain / Encrypted Config)                 │    │
│  │                                                                 │    │
│  │  • GOOGLE_CLIENT_ID                                             │    │
│  │  • TWITCH_CLIENT_ID                                             │    │
│  │  • BACKEND_URL                                                  │    │
│  │  • FUNC_KEY (Azure Functions key)                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Launch Browser/Webview with URL:                                │    │
│  │ https://org.github.io/login?source=obsidian&nonce=X&provider=Y  │    │
│  │                             #funcKey=Z                          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
                 ▼                                       ▼
┌─────────────────────────────┐         ┌─────────────────────────────────┐
│       GITHUB PAGES          │         │           BROWSER               │
│                             │         │                                 │
│  Receives HTTP request:     │         │  Hash fragment stays here:      │
│  GET /login?source=...      │         │  #funcKey=Z                     │
│  Host: org.github.io        │         │                                 │
│                             │         │  ⚠️ NOT sent to server          │
│  ❌ No secrets in request   │         │                                 │
│                             │         └─────────────────────────────────┘
│  Returns: index.html + JS   │
└─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          SPA (Running in Browser)                        │
│                                                                          │
│  1. Parse hash fragment (funcKey) and query params (nonce, provider)     │
│  2. Store values in memory, clear hash from URL bar                      │
│  3. Initialize selected OAuth provider (Google or Twitch)                │
│  4. User authenticates → receive ID token (JWT with zkLogin nonce)       │
│  5. Exchange token with Azure Easy Auth → get session token              │
│  6. Call bridge API → get Sui address and salt                           │
│  7. Redirect back to desktop app via deeplink                            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ API requests with Authorization header
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            BACKEND SERVER                                │
│                                                                          │
│  • Validates API_SECRET on every request                                 │
│  • Rejects unauthorized requests (DoS protection)                        │
│  • Processes authenticated requests                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Security Model

### 3.1 Why Hash Fragments?

| Aspect | Query Parameters (`?`) | Hash Fragments (`#`) |
|--------|------------------------|----------------------|
| Sent to server | ✅ Yes | ❌ No |
| Appears in server logs | ✅ Yes | ❌ No |
| Included in Referer header | ✅ Yes | ❌ No |
| Accessible via JavaScript | ✅ Yes | ✅ Yes |

Hash fragments are purely client-side. The browser never transmits them to any server, making them ideal for passing secrets to an SPA.

### 3.2 Transport Security

- All communication occurs over HTTPS
- URL fragments are encrypted in transit (part of the encrypted payload)
- Only the domain name is visible to network observers

### 3.3 DoS Protection

The backend server requires a valid `API_SECRET` for all requests:

- Requests without valid secret are rejected immediately
- Attackers cannot abuse the API without possessing the secret
- The secret is never exposed in the public repository

### 3.4 Secret Lifecycle

| Stage | Location | Duration |
|-------|----------|----------|
| At rest | Desktop app secure storage | Persistent |
| In transit | URL hash fragment (HTTPS) | Momentary |
| In use | SPA memory (JavaScript variable) | Session only |
| Cleared | Removed from URL bar | Immediate |

---

## 4. Implementation

### 4.1 Desktop App Requirements

The desktop application must:

1. Store secrets securely (OS keychain, encrypted config file, etc.)
2. Generate a zkLogin nonce (ephemeral key pair)
3. Construct the launch URL with query params and hash fragment
4. Open the URL in a browser or embedded webview
5. Listen for deeplink callback with authentication result

#### Example URL Construction (pseudocode)

```typescript
base_url = "https://your-org.github.io/login"

// Query parameters (non-sensitive, can be logged)
query_params = {
    "source": "obsidian",
    "nonce": zkLoginNonce,           // Generated ephemeral key nonce
    "provider": "google" | "twitch"  // Selected auth provider
}

// Hash fragment (sensitive, never sent to server)
hash_params = {
    "funcKey": AZURE_FUNCTION_KEY
}

launch_url = base_url + "?" + urlencode(query_params) + "#" + urlencode(hash_params)

// Result: https://your-org.github.io/login?source=obsidian&nonce=XXX&provider=google#funcKey=YYY
```

### 4.2 SPA Implementation

#### 4.2.1 Multi-Provider Architecture

The SPA uses a provider-agnostic architecture that supports multiple OAuth/OIDC providers:

```
services/
├── auth/
│   ├── AuthProvider.ts        # Base interface for all providers
│   ├── GoogleAuthProvider.ts  # Google Identity Services implementation
│   ├── TwitchAuthProvider.ts  # Twitch OIDC implicit flow
│   └── index.ts               # Provider factory
└── BridgeService.ts           # Azure Easy Auth + Enoki bridge
```

#### 4.2.2 Auth Provider Interface

```typescript
// services/auth/AuthProvider.ts

export type AuthProviderType = 'google' | 'twitch';

export interface CredentialResponse {
  credential: string;      // JWT ID token
  provider: AuthProviderType;
}

export type CredentialCallback = (response: CredentialResponse) => void;

export interface AuthProvider {
  readonly name: AuthProviderType;
  
  loadScript(): Promise<void>;
  initialize(nonce: string, callback: CredentialCallback): void;
  renderButton(container: HTMLElement): void;
  isInitialized(): boolean;
  reset(): void;
  cancel(): void;
  
  // For redirect-based flows (Twitch)
  initiateAuth?(): void;
  handleCallback?(): CredentialResponse | null;
  isCallback?(): boolean;
}
```

#### 4.2.3 Provider Factory

```typescript
// services/auth/index.ts

import { GoogleAuthProvider } from './GoogleAuthProvider';
import { TwitchAuthProvider } from './TwitchAuthProvider';

const providers: Map<AuthProviderType, AuthProvider> = new Map();

export function getAuthProvider(type: AuthProviderType): AuthProvider {
  let provider = providers.get(type);
  
  if (!provider) {
    switch (type) {
      case 'google':
        provider = new GoogleAuthProvider();
        break;
      case 'twitch':
        provider = new TwitchAuthProvider();
        break;
      default:
        throw new Error(`Unknown auth provider: ${type}`);
    }
    providers.set(type, provider);
  }
  
  return provider;
}
```

#### 4.2.4 Google Provider (Popup Flow)

Uses Google Identity Services (GIS) library with custom nonce for zkLogin:

```typescript
// Key points:
// - Loads external script: https://accounts.google.com/gsi/client
// - Uses popup-based flow (no redirect)
// - Nonce is passed to GIS initialize() for JWT binding
// - Returns credential via callback immediately
```

#### 4.2.5 Twitch Provider (Redirect Flow)

Uses standard OIDC implicit flow with redirect:

```typescript
// Key points:
// - No external script required
// - Redirects to: https://id.twitch.tv/oauth2/authorize
// - Parameters: response_type=id_token, scope=openid, nonce, state
// - Returns via URL fragment: #id_token=XXX&state=YYY
// - State parameter provides CSRF protection
```

#### 4.2.6 Bridge Service

Handles Azure Easy Auth token exchange and Enoki bridge API:

```typescript
// services/BridgeService.ts

class BridgeService {
  async completeAuthentication(
    provider: AuthProviderType,
    idToken: string
  ): Promise<AuthenticationResult> {
    // 1. Exchange ID token for Azure session
    const azureToken = await this.exchangeTokenForAzureSession(provider, idToken);
    
    // 2. Call bridge API to get Sui address and salt
    const { salt, address } = await this.hydrateUserData(provider, idToken, azureToken);
    
    return { provider, jwt: idToken, azureToken, salt, address };
  }
  
  private async exchangeTokenForAzureSession(
    provider: AuthProviderType,
    idToken: string
  ): Promise<string> {
    // POST to /.auth/login/{provider}
    const authEndpoint = provider === 'twitch' ? 'twitch' : 'google';
    const response = await fetch(`${this.baseUrl}/.auth/login/${authEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
    
    const data = await response.json();
    return data.authenticationToken;
  }
}
```

### 4.3 Backend Implementation

The backend must validate the API secret on every request:

```typescript
// middleware/auth.ts (Express example)

import { Request, Response, NextFunction } from 'express';

const VALID_API_SECRET = process.env.API_SECRET;

export function validateApiSecret(
  req: Request, 
  res: Response, 
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  
  const token = authHeader.slice(7); // Remove 'Bearer ' prefix
  
  if (token !== VALID_API_SECRET) {
    res.status(403).json({ error: 'Invalid API secret' });
    return;
  }
  
  next();
}

// Apply to all API routes
app.use('/api', validateApiSecret);
```

---

## 5. URL Parameter Specification

### 5.1 Query Parameters (Non-Sensitive)

| Parameter | Required | Description |
|-----------|----------|-------------|
| `source` | Yes | Must be `obsidian` to indicate valid launch |
| `nonce` | Yes | zkLogin nonce (binds JWT to ephemeral key pair) |
| `provider` | No | Auth provider: `google` (default) or `twitch` |

### 5.2 Hash Fragment Parameters (Sensitive)

| Parameter | Required | Description |
|-----------|----------|-------------|
| `funcKey` | Yes | Azure Functions key for API authentication |

### 5.3 Environment Variables (Build-time)

| Variable | Description |
|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `VITE_TWITCH_CLIENT_ID` | Twitch OAuth Client ID |
| `VITE_BACKEND_URL` | Azure Function App backend URL |

### 5.4 Example URLs

**Development (Google):**
```
http://localhost:5173/?source=obsidian&nonce=abc123&provider=google#funcKey=dev_key_xxx
```

**Development (Twitch):**
```
http://localhost:5173/?source=obsidian&nonce=abc123&provider=twitch#funcKey=dev_key_xxx
```

**Production:**
```
https://your-org.github.io/login?source=obsidian&nonce=abc123&provider=google#funcKey=prod_key_xxx
```

---

## 6. Security Considerations

### 6.1 What This Approach Protects Against

| Threat | Protection |
|--------|------------|
| Secrets in public repo | ✅ Secrets never committed to code |
| Secrets in server logs | ✅ Hash fragments not sent to server |
| Unauthorized API access | ✅ Backend validates secret on every request |
| Network eavesdropping | ✅ HTTPS encrypts all traffic |

### 6.2 Remaining Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Secret extracted from desktop app | Low | Use OS keychain, code obfuscation |
| Compromised desktop app installation | Low | Code signing, secure distribution |
| Memory inspection in browser | Low | Clear config after use if possible |
| Shoulder surfing URL bar | Very Low | Hash cleared immediately on load |

### 6.3 Content Security Policy (CSP)

The SPA includes a CSP meta tag to mitigate XSS attacks:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://accounts.google.com;
  frame-src https://accounts.google.com;
  connect-src 'self' https://*.azurewebsites.net https://id.twitch.tv;
  style-src 'self' 'unsafe-inline' https://accounts.google.com;
  img-src 'self' data: https:;
">
```

**Note:** For stronger protection, use HTTP headers via Cloudflare or Azure Static Web Apps instead of meta tags.

### 6.4 Recommendations

1. **Rotate secrets periodically** - Implement a mechanism to update the function key
2. **Use CSP headers** - Deploy behind Cloudflare for proper HTTP header CSP
3. **Monitor backend logs** - Alert on unusual patterns or failed authentication attempts
4. **Validate nonce server-side** - Ensure the JWT nonce matches expected format

---

## 7. Testing

### 7.1 Local Development

For local testing, create a simple HTML file to simulate the desktop app launch:

```html
<!-- test-launcher.html (DO NOT commit to repo) -->
<!DOCTYPE html>
<html>
<head>
  <title>Test Launcher</title>
</head>
<body>
  <h1>Test Launcher</h1>
  <select id="provider">
    <option value="google">Google</option>
    <option value="twitch">Twitch</option>
  </select>
  <button onclick="launch()">Launch SPA</button>
  
  <script>
    function launch() {
      const provider = document.getElementById('provider').value;
      const nonce = 'test_nonce_' + Date.now();
      
      const queryParams = new URLSearchParams({
        source: 'obsidian',
        nonce: nonce,
        provider: provider
      });
      
      const hashParams = new URLSearchParams({
        funcKey: 'your-azure-function-key'
      });
      
      window.open(`http://localhost:5173/?${queryParams.toString()}#${hashParams.toString()}`);
    }
  </script>
</body>
</html>
```

### 7.2 Test Cases

| Test Case | Expected Result |
|-----------|-----------------|
| Launch with Google provider | Google Sign-In button appears |
| Launch with Twitch provider | Twitch Sign-In button appears |
| Launch with missing nonce | Error displayed, app does not proceed |
| Launch with invalid funcKey | Backend returns 401/403 on API calls |
| Inspect URL after load | Hash fragment is cleared |
| Complete Google auth flow | Deeplink returns to Obsidian with credentials |
| Complete Twitch auth flow | Redirect callback handled, deeplink returns |
| Check network requests to GitHub Pages | No secrets in request |

---

## 8. Deployment Checklist

- [ ] SPA code contains no hardcoded secrets
- [ ] `.gitignore` includes any local test files with secrets
- [ ] GitHub Pages is configured for the repository
- [ ] HTTPS is enabled on GitHub Pages
- [ ] Environment variables set: `VITE_GOOGLE_CLIENT_ID`, `VITE_TWITCH_CLIENT_ID`, `VITE_BACKEND_URL`
- [ ] Google OAuth client configured with correct redirect URI
- [ ] Twitch OAuth client configured with correct redirect URI
- [ ] Azure Easy Auth configured for Google provider
- [ ] Azure Easy Auth configured for Twitch (custom OIDC provider)
- [ ] Desktop app securely stores Azure function key
- [ ] Desktop app constructs launch URL correctly with query params + hash fragment
- [ ] End-to-end flow tested for both Google and Twitch providers

---

## 9. Adding New OAuth Providers

The architecture supports adding new OpenID Connect providers. Follow these steps:

### 9.1 Prerequisites

1. **Provider must support OIDC** with `nonce` parameter in ID tokens (required for zkLogin)
2. **Provider must support implicit flow** (`response_type=id_token`) for client-side apps
3. **Azure Easy Auth** must be configured for the provider (built-in or custom OIDC)

### 9.2 Implementation Steps

#### Step 1: Add Provider Type

Update `services/auth/AuthProvider.ts`:

```typescript
export type AuthProviderType = 'google' | 'twitch' | 'newprovider';
```

#### Step 2: Create Provider Class

Create `services/auth/NewProviderAuthProvider.ts`:

```typescript
import type { AuthProvider, CredentialCallback, CredentialResponse } from './AuthProvider';

export class NewProviderAuthProvider implements AuthProvider {
  public readonly name = 'newprovider' as const;
  
  // Implement all interface methods:
  // - loadScript(): Load external SDK if needed
  // - initialize(nonce, callback): Store nonce, check for callback
  // - renderButton(container): Create sign-in button
  // - initiateAuth(): Redirect to provider's authorize URL
  // - handleCallback(): Parse ID token from URL fragment
  // - isCallback(): Check if current URL is a callback
}
```

#### Step 3: Register in Factory

Update `services/auth/index.ts`:

```typescript
import { NewProviderAuthProvider } from './NewProviderAuthProvider';

// In getAuthProvider():
case 'newprovider':
  provider = new NewProviderAuthProvider();
  break;
```

#### Step 4: Add Configuration

Update `config.ts`:

```typescript
interface BridgeConfig {
  // ...existing fields
  newProviderClientId: string;
}

// In getBridgeConfig():
newProviderClientId: import.meta.env.VITE_NEWPROVIDER_CLIENT_ID || '',
```

#### Step 5: Update CSP

Add provider domains to `index.html` CSP meta tag:

```html
connect-src 'self' ... https://newprovider.example.com;
```

#### Step 6: Configure Azure

Add the provider to Azure Easy Auth:
- For built-in providers (Google, Microsoft, Facebook, Twitter): Use Azure portal
- For custom OIDC providers: Configure with provider's discovery URL

#### Step 7: Update Deeplink Parser

Update `utils/deeplink.ts` to accept the new provider:

```typescript
if (provider !== 'google' && provider !== 'twitch' && provider !== 'newprovider') {
  console.error('[Deeplink] Invalid provider:', provider);
  return null;
}
```

### 9.3 Provider-Specific Notes

| Provider | Flow Type | External Script | Notes |
|----------|-----------|-----------------|-------|
| Google | Popup | Yes (GIS) | Uses Google Identity Services library |
| Twitch | Redirect | No | Standard OIDC implicit flow |
| Apple | Redirect | Yes | Requires Apple JS SDK |
| Microsoft | Popup/Redirect | Yes (MSAL) | Can use MSAL.js library |
| Discord | Redirect | No | Standard OIDC implicit flow |

---

## 10. Appendix

### 10.1 Alternative Approaches Considered

| Approach | Why Not Used |
|----------|--------------|
| Environment variables at build time | Secrets still visible in deployed JS bundle |
| `.env` files | Would be committed to public repo or require build pipeline |
| Backend proxy for all requests | Adds complexity; unnecessary given current architecture |
| Query parameters (`?`) | Sent to server, appears in logs |

### 10.2 References

- [URL Living Standard - Fragments](https://url.spec.whatwg.org/#concept-url-fragment)
- [MDN - Window.location.hash](https://developer.mozilla.org/en-US/docs/Web/API/Location/hash)
- [OWASP - Sensitive Data Exposure](https://owasp.org/www-project-web-security-testing-guide/)
- [Twitch OIDC Documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
- [Azure Easy Auth - Custom OIDC](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-openid-connect)