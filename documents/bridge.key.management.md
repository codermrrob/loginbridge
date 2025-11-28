To generate the key pair in Obsidian **before** you trigger the bridge, you need to use the low-level primitives provided by the `@mysten/sui` and `@mysten/zklogin` packages.

You are essentially manually performing the first step of the zkLogin flow that the SDK usually hides from you.

### 1. Install Required Dependencies
In your Obsidian plugin folder, ensure you have these packages:

```bash
npm install @mysten/sui @mysten/zklogin
```

### 2. The Key Generation Service (`EphemeralKeyManager.ts`)

Create a helper class in your plugin. This class will:
1.  Generate a standard Ed25519 key pair.
2.  Fetch the current network epoch (needed for the nonce).
3.  Calculate the nonce.
4.  **Crucial:** Save the private key to `localStorage` so it is waiting for you when the user returns from the browser.

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness } from '@mysten/zklogin';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// Helper to manage the temporary key
export class EphemeralKeyManager {
    private storageKey = 'enoki_pending_ephemeral';

    async prepareLoginForBridge(): Promise<string> {
        // 1. Initialize Client to get current epoch
        const client = new SuiClient({ url: getFullnodeUrl('testnet') });
        const { epoch } = await client.getLatestSuiSystemState();

        // 2. Set Expiration
        // We set the validity to current epoch + 2 (approx 48 hours buffer)
        // This means the JWT will be invalid if the transaction is submitted after this epoch.
        const maxEpoch = Number(epoch) + 2;

        // 3. Generate a fresh Key Pair (The "Ephemeral Key")
        const ephemeralKeyPair = new Ed25519Keypair();
        
        // 4. Generate Randomness (Required for privacy/security in zkLogin)
        const randomness = generateRandomness();

        // 5. Calculate the Nonce
        // This is the string we send to Google. It binds the JWT to this specific key pair.
        const nonce = generateNonce(
            ephemeralKeyPair.getPublicKey(), 
            maxEpoch, 
            randomness
        );

        // 6. SAVE STATE (CRITICAL)
        // When the user comes back from the browser, we need this private key
        // to sign transactions. If we lose it, the JWT is useless.
        const pendingSession = {
            ephemeralPrivateKey: ephemeralKeyPair.getSecretKey(), // string format
            maxEpoch: maxEpoch,
            randomness: randomness.toString(), // Convert BigInt to string for storage
            timestamp: Date.now()
        };

        window.localStorage.setItem(this.storageKey, JSON.stringify(pendingSession));

        return nonce;
    }

    // Call this when the Deep Link returns
    getPendingKeyPair() {
        const stored = window.localStorage.getItem(this.storageKey);
        if (!stored) return null;

        const data = JSON.parse(stored);
        
        // Reconstruct the KeyPair from the stored secret
        const keypair = Ed25519Keypair.fromSecretKey(data.ephemeralPrivateKey);
        
        return {
            keypair,
            maxEpoch: data.maxEpoch,
            randomness: BigInt(data.randomness) // Convert back to BigInt
        };
    }
}
```

### 3. Usage in your Login Flow

Update your "Log in via Browser" button handler in your React component to use this manager.

```tsx
import { EphemeralKeyManager } from './EphemeralKeyManager';

const handleLoginClick = async () => {
    const keyManager = new EphemeralKeyManager();
    
    // 1. Generate keys and get the nonce (Async because it fetches Epoch)
    const nonce = await keyManager.prepareLoginForBridge();

    // 2. Construct the URL with the Nonce
    const bridgeUrl = "https://your-bridge.com/";
    const params = new URLSearchParams({
        source: 'obsidian',
        nonce: nonce // <--- PASSING THE NONCE
    });

    // 3. Open the browser
    window.open(`${bridgeUrl}?${params.toString()}`);
};
```

### 4. Rehydrating on Return (`main.ts`)

When `obsidian://enoki-auth` triggers, you need to combine the returned JWT with the stored Private Key to create a fully functional signer.

```typescript
// Inside main.ts protocol handler
this.registerObsidianProtocolHandler("enoki-auth", async (params) => {
    const { jwt, salt, address } = params;
    
    // 1. Retrieve the waiting key pair
    const keyManager = new EphemeralKeyManager();
    const pending = keyManager.getPendingKeyPair();

    if (!pending) {
        console.error("No pending login session found. User might have restarted Obsidian.");
        return;
    }

    // 2. We now have everything needed to sign transactions:
    // - JWT (Proof of Identity)
    // - Salt (User specific constant)
    // - Ephemeral Private Key (The signer)
    // - Address (The public identifier)
    
    // 3. Persist this as the "Active Session" for Enoki/dapp-kit
    const fullSession = {
        jwt,
        salt,
        address,
        ephemeralPrivateKey: pending.keypair.getSecretKey(),
        maxEpoch: pending.maxEpoch,
        randomness: pending.randomness.toString()
    };
    
    window.localStorage.setItem('enoki_active_session', JSON.stringify(fullSession));
    
    // 4. Clear the pending state
    window.localStorage.removeItem('enoki_pending_ephemeral');
    
    // 5. Notify UI to reload
    this.app.workspace.trigger('enoki-plugin:login-success');
});
```

### Summary of the Mechanism
1.  **Obsidian** creates a key pair (`ek_pub`, `ek_priv`).
2.  **Obsidian** saves `ek_priv` to storage.
3.  **Obsidian** calculates `nonce = Hash(ek_pub, ...)` and sends it to Bridge.
4.  **Bridge** sends `nonce` to Google (OIDC).
5.  **Google** puts `nonce` inside the JWT.
6.  **Bridge** receives JWT, calls Backend to fetch Salt, and sends (JWT + Salt) back to Obsidian.
7.  **Obsidian** retrieves `ek_priv`.
8.  **Obsidian** verifies: `Does the JWT contain the hash of ek_pub?` (Implicitly, via the zkLogin logic).
9.  **Result:** You can now sign transactions using `ek_priv`, and the network accepts them because the JWT proves you own the `ek_pub` inside the nonce.
