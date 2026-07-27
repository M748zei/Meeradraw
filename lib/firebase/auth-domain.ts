function normalizedHost(value: string | undefined): string | undefined {
  const host = value?.trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/.test(host)) return undefined;
  return host;
}

/**
 * Firebase redirect auth must use the same origin as the production app on
 * browsers that partition third-party storage (notably Safari on iPhone).
 * Preview and local hosts keep using the configured Firebase helper domain.
 */
export function resolveFirebaseAuthDomain(
  configuredAuthDomain: string | undefined,
  publicAppUrl: string | undefined,
  browserHost: string | undefined
): string | undefined {
  const configured = normalizedHost(configuredAuthDomain);
  const current = normalizedHost(browserHost);
  if (!current || !publicAppUrl) return configured;

  try {
    const appUrl = new URL(publicAppUrl);
    const appHost = normalizedHost(appUrl.host);
    if (appUrl.protocol === "https:" && appHost === current) {
      return appHost;
    }
  } catch {
    // Keep the Firebase-hosted auth domain when the public app URL is invalid.
  }

  return configured;
}
