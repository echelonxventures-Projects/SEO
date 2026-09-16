export type SocialAppCreds = {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authorizeUrl?: string | null; // adapter default when empty
  tokenUrl?: string | null;
  apiBase?: string | null;
  headers?: Record<string, string>;
};

export type TokenBundle = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalAccountId: string;
  handle: string;
  displayName?: string | null;
  pictureUrl?: string | null;
};

export type PublishInput = {
  accessToken: string;
  externalAccountId: string;
  text: string;
  linkUrl?: string | null;
  apiBase?: string | null;
  headers?: Record<string, string>;
};

export type PublishResult = { externalId: string; url?: string | null };

/**
 * Social network plugin contract. authorize/exchange implement the OAuth 2.0
 * dance; publish implements the network's write endpoint. Adapters must not
 * log or persist tokens — the service layer encrypts them.
 */
export interface SocialProviderAdapter {
  key: string;
  label: string;
  capabilities?: string[];
  authorizeUrl(creds: SocialAppCreds, state: string, redirectUri: string, pkce?: { challenge: string }): string;
  exchangeCode(creds: SocialAppCreds, code: string, redirectUri: string, verifier: string | null): Promise<TokenBundle>;
  publish(input: PublishInput): Promise<PublishResult>;
  refresh?(creds: SocialAppCreds, refreshToken: string): Promise<{ accessToken: string; expiresAt: Date } | null>;
}

export function graphVersion(): string {
  return process.env.OMNI_GRAPH_VERSION ?? "v21.0";
}
