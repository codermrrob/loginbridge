# Secure SPA Authentication Flow

## Developer Specification

---

## 1. Overview

This document specifies a secure method for deploying a login Single Page Application (SPA) to a public GitHub repository while protecting sensitive configuration values from exposure.

### 1.1 Problem Statement

The SPA requires access to sensitive configuration values:

- Google Client ID
- Backend Server URL
- Enoki Public API Key
- Backend API Secret Key

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
│  │  • BACKEND_URL                                                  │    │
│  │  • ENOKI_API_KEY                                                │    │
│  │  • API_SECRET                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Launch Browser/Webview with URL:                                │    │
│  │ https://org.github.io/login#clientId=X&backendUrl=Y&enoki=Z&... │    │
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
│  GET /login HTTP/1.1        │         │  #clientId=X&backendUrl=Y&...   │
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
│  1. Parse hash fragment                                                  │
│  2. Store values in memory                                               │
│  3. Clear hash from URL bar                                              │
│  4. Use values for authentication flow                                   │
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
2. Construct the launch URL with secrets as hash fragment parameters
3. Open the URL in a browser or embedded webview

#### Example URL Construction (pseudocode)

```typescript
base_url = "https://your-org.github.io/login"
params = {
    "clientId": GOOGLE_CLIENT_ID,
    "backendUrl": BACKEND_URL,
    "enokiKey": ENOKI_API_KEY,
    "apiSecret": API_SECRET
}
hash_fragment = urlencode(params)
launch_url = base_url + "#" + hash_fragment

// Result: https://your-org.github.io/login#clientId=XXX&backendUrl=YYY&enokiKey=ZZZ&apiSecret=SSS
```

### 4.2 SPA Implementation

#### 4.2.1 Configuration Parser

```typescript
// config.ts

interface AppConfig {
  googleClientId: string;
  backendUrl: string;
  enokiKey: string;
  apiSecret: string;
}

export function parseConfigFromHash(): AppConfig | null {
  const hash = window.location.hash;
  
  if (!hash || hash.length <= 1) {
    console.error('No configuration provided in URL hash');
    return null;
  }
  
  // Remove leading '#' and parse
  const params = new URLSearchParams(hash.slice(1));
  
  const config: AppConfig = {
    googleClientId: params.get('clientId') ?? '',
    backendUrl: params.get('backendUrl') ?? '',
    enokiKey: params.get('enokiKey') ?? '',
    apiSecret: params.get('apiSecret') ?? ''
  };
  
  // Validate required fields
  const requiredFields: (keyof AppConfig)[] = [
    'googleClientId', 
    'backendUrl', 
    'enokiKey', 
    'apiSecret'
  ];
  
  for (const field of requiredFields) {
    if (!config[field]) {
      console.error(`Missing required config field: ${field}`);
      return null;
    }
  }
  
  // Clear hash from URL bar immediately
  window.history.replaceState(null, '', window.location.pathname);
  
  return config;
}
```

#### 4.2.2 Application Initialization

```typescript
// main.ts

import { parseConfigFromHash, AppConfig } from './config';

// Store config in module scope (memory only)
let appConfig: AppConfig | null = null;

function initializeApp(): void {
  appConfig = parseConfigFromHash();
  
  if (!appConfig) {
    displayError('Application configuration missing. Please launch from the desktop app.');
    return;
  }
  
  // Initialize services with config
  initializeGoogleAuth(appConfig.googleClientId);
  initializeEnoki(appConfig.enokiKey);
  initializeApiClient(appConfig.backendUrl, appConfig.apiSecret);
  
  // Render the application
  renderApp();
}

// Run on load
document.addEventListener('DOMContentLoaded', initializeApp);
```

#### 4.2.3 API Client

```typescript
// api-client.ts

class ApiClient {
  private baseUrl: string;
  private apiSecret: string;
  
  constructor(baseUrl: string, apiSecret: string) {
    this.baseUrl = baseUrl;
    this.apiSecret = apiSecret;
  }
  
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.apiSecret}`);
    headers.set('Content-Type', 'application/json');
    
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    
    return response.json();
  }
  
  // Convenience methods
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }
  
  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
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

### 5.1 Hash Fragment Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `clientId` | Yes | Google OAuth Client ID |
| `backendUrl` | Yes | Full URL to backend server (e.g., `https://api.example.com`) |
| `enokiKey` | Yes | Enoki public API key |
| `apiSecret` | Yes | Secret key for backend authentication |

### 5.2 Example URLs

**Development:**
```
https://localhost:5173/#clientId=123456.apps.googleusercontent.com&backendUrl=http://localhost:3000&enokiKey=enoki_dev_xxx&apiSecret=dev_secret_123
```

**Production:**
```
https://your-org.github.io/login#clientId=123456.apps.googleusercontent.com&backendUrl=https://api.yourapp.com&enokiKey=enoki_prod_xxx&apiSecret=prod_secret_456
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

### 6.3 Recommendations

1. **Rotate secrets periodically** - Implement a mechanism to update the API secret
2. **Consider per-user secrets** - Allows revocation if one user is compromised
3. **Add request signing** - For additional security, sign requests with timestamp to prevent replay attacks
4. **Monitor backend logs** - Alert on unusual patterns or failed authentication attempts

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
  <button onclick="launch()">Launch SPA</button>
  
  <script>
    function launch() {
      const params = new URLSearchParams({
        clientId: 'your-google-client-id',
        backendUrl: 'http://localhost:3000',
        enokiKey: 'your-enoki-key',
        apiSecret: 'your-api-secret'
      });
      
      window.open(`http://localhost:5173/#${params.toString()}`);
    }
  </script>
</body>
</html>
```

### 7.2 Test Cases

| Test Case | Expected Result |
|-----------|-----------------|
| Launch with all parameters | App initializes successfully |
| Launch with missing parameter | Error displayed, app does not proceed |
| Launch with invalid API secret | Backend returns 403 on API calls |
| Inspect URL after load | Hash fragment is cleared |
| Check network requests to GitHub Pages | No secrets in request |

---

## 8. Deployment Checklist

- [ ] SPA code contains no hardcoded secrets
- [ ] `.gitignore` includes any local test files with secrets
- [ ] GitHub Pages is configured for the repository
- [ ] HTTPS is enabled on GitHub Pages
- [ ] Backend is deployed with API secret validation
- [ ] Desktop app securely stores all required secrets
- [ ] Desktop app constructs launch URL correctly with hash fragment
- [ ] End-to-end flow tested in production environment

---

## 9. Appendix

### 9.1 Alternative Approaches Considered

| Approach | Why Not Used |
|----------|--------------|
| Environment variables at build time | Secrets still visible in deployed JS bundle |
| `.env` files | Would be committed to public repo or require build pipeline |
| Backend proxy for all requests | Adds complexity; unnecessary given current architecture |
| Query parameters (`?`) | Sent to server, appears in logs |

### 9.2 References

- [URL Living Standard - Fragments](https://url.spec.whatwg.org/#concept-url-fragment)
- [MDN - Window.location.hash](https://developer.mozilla.org/en-US/docs/Web/API/Location/hash)
- [OWASP - Sensitive Data Exposure](https://owasp.org/www-project-web-security-testing-guide/)