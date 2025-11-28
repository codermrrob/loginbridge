# Obsidian Enoki Bridge SPA

This directory contains the **Kickstart Code** for the Obsidian Bridge Single Page Application (SPA).

## System Overview

The **Bridge SPA** is a lightweight, stateless web application designed to facilitate secure **zkLogin** authentication for the Obsidian Desktop Plugin. Because the Obsidian App (Electron) cannot securely handle OIDC redirects or easily serve as a public HTTPS origin for callbacks, this Bridge acts as a secure proxy.

**Core Responsibilities:**
1.  **Ingest:** Receives login intent from Obsidian.
2.  **Bind:** Captures the `nonce` (Ephemeral Key) from Obsidian to bind the session.
3.  **Authenticate:** Redirects to Google (OIDC).
4.  **Hydrate:** Exchanges the Google ID Token for the user's persistent **Salt** and **Address** via the Backend.
5.  **Eject:** Redirects back to Obsidian via a custom protocol (`obsidian://`) with the full credential payload.

---

## The "Nonce" & Key Management Strategy

To allow the Obsidian Plugin to **sign transactions** (not just read data), the authentication flow is "Split-Brain":

### 1. The Desktop (Signer)
The Obsidian Plugin is responsible for the **cryptographic keys**.
*   It generates an **Ephemeral Key Pair** (`ek_pub`, `ek_priv`) locally.
*   It calculates a **Nonce** based on `ek_pub` and the current Epoch.
*   It saves `ek_priv` securely in local storage.
*   **It never sends `ek_priv` to the Bridge.**

### 2. The Bridge (Authenticator)
The Bridge is responsible for **identity verification**.
*   It receives the `nonce` from Obsidian via URL query parameter.
*   It passes this `nonce` to Google during the OAuth login.
*   Google embeds this `nonce` into the **ID Token (JWT)**.

### 3. The Result
When the Bridge returns the **JWT** + **Salt** to Obsidian:
*   Obsidian recombines them with the stored `ek_priv`.
*   The **JWT** serves as the "Proof" that the user authorized the key pair.
*   The **Salt** is the user-specific constant needed for address derivation.
*   The **Address** confirms the identity.

**This allows the Desktop App to sign transactions without the Bridge ever seeing the private key.**

---

## Authentication Flow

1.  **Initiation (Obsidian):**
    *   Generates Ephemeral Key Pair.
    *   Opens `https://bridge-app.com/?source=obsidian&nonce=YOUR_NONCE`.

2.  **Ingest (Bridge):**
    *   `App.tsx` detects `source=obsidian`.
    *   Captures `nonce`.
    *   Redirects to Google OIDC URL, including `nonce` in the request.

3.  **Callback (Bridge):**
    *   Google redirects back to `https://bridge-app.com/#id_token=...`.
    *   `App.tsx` extracts `id_token`.

4.  **Hydration (Backend):**
    *   Bridge calls `POST /api/auth/bridge` with the `id_token`.
    *   Backend uses `EnokiClient` to fetch the **User Salt**.
    *   Backend returns `{ address, salt }`.

5.  **Ejection (Bridge):**
    *   Bridge constructs the Deep Link:
        `obsidian://enoki-auth?jwt=...&salt=...&address=...`
    *   Browser redirects, triggering the Obsidian Protocol Handler.

---

## Project Structure

*   **`App.tsx`**: The main state machine. Handles the URL parsing, OIDC construction, and Deep Link redirection.
*   **`services/BridgeService.ts`**: Client-side service that talks to the Backend (`/api/auth/bridge`) to fetch the salt.
*   **`config.ts`**: Environment configuration (Google Client ID, Backend URL).
*   **`types.ts`**: TypeScript definitions for the Bridge payload and state.

## Backend Requirements

This SPA relies on a specific endpoint in the Backend to retrieve the Salt (which is not standard in all Login flows).

**Endpoint:** `POST /api/auth/bridge`
**Response:**
```json
{
  "success": true,
  "address": "0x...",
  "salt": "123..." 
}
```

## Configuration

Create a `.env` file in the root of the SPA project:

```env
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_BACKEND_URL=https://your-backend-api.azurewebsites.net
VITE_ENOKI_PUBLIC_API_KEY=your-enoki-public-key (Optional, if using SDK helpers)
```
