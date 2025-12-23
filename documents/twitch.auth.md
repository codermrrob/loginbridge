Now I have all the details. Here's the complete Twitch OIDC endpoint reference:

## Twitch OIDC Endpoints Summary

### Key Endpoints

| Endpoint | URL |
|----------|-----|
| **Discovery** | `https://id.twitch.tv/oauth2/.well-known/openid-configuration` |
| **Authorization** | `https://id.twitch.tv/oauth2/authorize` |
| **Token** | `https://id.twitch.tv/oauth2/token` |
| **UserInfo** | `https://id.twitch.tv/oauth2/userinfo` |
| **JWKS (public keys)** | `https://id.twitch.tv/oauth2/keys` |
| **Issuer** | `https://id.twitch.tv/oauth2` |

### For Your Implicit Flow (Client-Side Bridge App)

To get a user access token using the implicit grant flow, navigate a user to `https://id.twitch.tv/oauth2/authorize` with these parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `client_id` | Yes | Your registered client ID |
| `redirect_uri` | Yes | Your registered redirect URI |
| `response_type` | Yes | `token id_token` — Returns an access token and an ID token, or `id_token` — Returns only an ID token |
| `scope` | Yes | A space-delimited list of scopes. The list must include the **openid** scope if *response_type* includes `id_token` |
| `nonce` | Recommended | Although optional, you are *strongly encouraged* to pass a nonce string. The server returns this string to you in the ID token's list of claims. **Critical for zkLogin!** |
| `state` | Recommended | The server returns this string to you in your redirect URI. Use this parameter if *response_type* includes `token`. |
| `claims` | No | A string-encoded JSON object that specifies the claims to include in the ID token |

### Example Authorization URL for zkLogin

```typescript
const authorizeUrl = new URL('https://id.twitch.tv/oauth2/authorize');
authorizeUrl.searchParams.set('client_id', twitchClientId);
authorizeUrl.searchParams.set('redirect_uri', redirectUri);
authorizeUrl.searchParams.set('response_type', 'id_token');  // Just ID token for zkLogin
authorizeUrl.searchParams.set('scope', 'openid user:read:email');
authorizeUrl.searchParams.set('nonce', nonce);  // CRITICAL for zkLogin
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('claims', JSON.stringify({
  id_token: {
    email: null,
    email_verified: null
  }
}));
```

### Callback Response

If the user authorized your app, the server sends the access token and ID token to your redirect URI **in the fragment portion** of the URI:

```
http://localhost:3000/
    #access_token=73gl5dipwta5fsfma3ia05woyffbp
    &id_token=eyJhbGciOiJSUzI1NiIsInR5cC6IkpXVCIsImtpZCI6IjEifQ...
    &scope=channel%253Amanage%253Apolls+channel%253Aread%253Apolls+openid
    &state=c3ab8aa609ea11e793ae92361f002671
    &token_type=bearer
```

In JavaScript, you can access the fragment using `document.location.hash`.

### Claims in the ID Token

**Default claims** (always included):

| Claim | Description |
|-------|-------------|
| `aud` | The client ID of the application that requested the user's authorization |
| `sub` | The ID of the user that authorized the app |
| `iss` | The URI of the issuing authority (`https://id.twitch.tv/oauth2`) |
| `exp` | The UNIX timestamp of when the token expires |
| `iat` | The UNIX timestamp of when the server issued the token |
| `nonce` | If your authorization request specifies the *nonce* query parameter, the ID token's payload also includes the `nonce` claim |

**Optional claims** (must request via `claims` parameter):

| Claim | Description |
|-------|-------------|
| `email` | The email address of the user that authorized the app |
| `email_verified` | A Boolean value that indicates whether Twitch has verified the user's email address |
| `picture` | A URL to the user's profile image |
| `preferred_username` | The user's display name |

If you specify the `email` or `email_verified` claims, you must include the **user:read:email** scope in your list of scopes.

### Azure OIDC Configuration

For Azure App Service, use these values:

```
Metadata URL: https://id.twitch.tv/oauth2/.well-known/openid-configuration
Scopes: openid user:read:email
```

