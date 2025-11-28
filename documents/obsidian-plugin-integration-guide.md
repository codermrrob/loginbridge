# Obsidian Plugin Integration & Testing Guide

This guide explains how to test the **Enoki Bridge SPA** integration with the Obsidian Plugin.

## 1. Bridge Setup (Local)

Before testing the plugin, ensure the Bridge SPA is running locally.

1.  Navigate to the app directory:
    ```bash
    cd loginbridge/app
    ```
2.  Install dependencies (if you haven't already):
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
4.  Note the local URL (usually `http://localhost:5173`).

## 2. Manual Connectivity Test

You can verify the Bridge is working correctly without modifying the Obsidian plugin yet.

1.  **Construct a Test URL:**
    Use a dummy nonce for this test.
    ```text
    http://localhost:5173/?source=obsidian&nonce=TEST_NONCE_123&provider=google
    ```

2.  **Open in Browser:**
    - You should see the "Enoki Bridge" interface.
    - Click **"Log in with Google"** (or it may auto-redirect if configured).

3.  **Complete Login:**
    - Sign in with a Google account.

4.  **Verify Handoff:**
    - After login, the bridge should display "Opening Obsidian...".
    - Your browser should prompt you to open the Obsidian app.
    - **Note:** If the "Open Obsidian" prompt appears, the Bridge is functioning correctly. The link will look like:
      `obsidian://enoki-auth?jwt=...&salt=...&address=...`

## 3. Integration Testing (Plugin Side)

To test the full end-to-end flow, you need to configure the Obsidian plugin to talk to your local bridge.

### Step A: Point Plugin to Local Bridge

In your plugin's authentication logic (where you generate the URL), temporarily point to localhost:

```typescript
// In your Login View or Controller
const BRIDGE_URL = "http://localhost:5173"; // DEV
// const BRIDGE_URL = "https://bridge.enoki.app"; // PROD

const params = new URLSearchParams({
    source: 'obsidian',
    nonce: generatedNonce // From EphemeralKeyManager
});

window.open(`${BRIDGE_URL}?${params.toString()}`);
```

### Step B: Handle the Protocol

Ensure your `main.ts` in the Obsidian plugin has the protocol handler registered. This matches the `obsidian://enoki-auth` scheme used by the Bridge.

```typescript
import { ObsidianProtocolData } from 'obsidian';

// Inside onload()
this.registerObsidianProtocolHandler("enoki-auth", async (data: ObsidianProtocolData) => {
    console.log("Bridge Callback Received:", data);
    
    const { jwt, salt, address } = data;
    
    if (!jwt || !salt || !address) {
        console.error("Missing required fields from Bridge");
        return;
    }

    // 1. Rehydrate the session using EphemeralKeyManager
    // 2. Verify the login
    // 3. Update UI
    console.log(`Logged in as ${address}`);
});
```

## 4. Troubleshooting

| Issue | Possible Cause | Fix |
| :--- | :--- | :--- |
| **Browser doesn't prompt to open Obsidian** | `obsidian://` protocol not registered. | Ensure you have run Obsidian at least once. Protocol registration is OS-level. |
| **Bridge stays on "Verifying..."** | Backend connection failed. | Check `VITE_BACKEND_URL` in `.env`. Ensure the backend is running at `http://localhost:7071`. |
| **"Bridge source not found" error** | Session storage missing. | You must start the flow from the `/?source=obsidian` URL. Accessing the callback URL directly will fail. |
| **Redirect URI Mismatch** | Google OAuth Error. | The `redirect_uri` sent to Google must match the authorized origins in Google Cloud Console. For local dev, `http://localhost:5173/auth/callback` must be whitelisted. |

## 5. Verification Checklist

- [ ] Bridge loads at `http://localhost:5173`.
- [ ] Clicking Login redirects to Google.
- [ ] Google redirects back to Bridge (`#id_token=...`).
- [ ] Bridge calls Backend (`POST /api/auth/bridge`).
- [ ] Bridge redirects to `obsidian://enoki-auth`.
- [ ] Obsidian plugin triggers `registerObsidianProtocolHandler`.
