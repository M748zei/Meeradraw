type FirebaseAuthRewrite = {
  source: string;
  destination: string;
};

export function firebaseAuthHelperDomain(
  configuredDomain: string | undefined
): string | null {
  const domain = configuredDomain?.trim().toLowerCase();
  if (
    !domain ||
    !/^[a-z0-9-]+\.(?:firebaseapp\.com|web\.app)$/.test(domain)
  ) {
    return null;
  }
  return domain;
}

export function firebaseAuthProxyRewrites(
  configuredDomain: string | undefined
): FirebaseAuthRewrite[] {
  const helperDomain = firebaseAuthHelperDomain(configuredDomain);
  if (!helperDomain) return [];

  return [
    {
      source: "/__/auth/:path*",
      destination: `https://${helperDomain}/__/auth/:path*`,
    },
    {
      source: "/__/firebase/init.json",
      destination: `https://${helperDomain}/__/firebase/init.json`,
    },
  ];
}
