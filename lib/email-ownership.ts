export function hasVerifiedEmailOwnership(
  tokenEmailVerified: boolean,
  providerIds: readonly string[] = []
) {
  return tokenEmailVerified || providerIds.includes("google.com");
}
