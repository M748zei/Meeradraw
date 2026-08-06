import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { firebaseAuthProxyRewrites } from "./config/firebase-auth-proxy";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "fal.media" },
      { protocol: "https", hostname: "**.fal.media" },
    ],
  },
  serverExternalPackages: [
    "firebase-admin",
    "@vercel/queue",
    "@vercel/oidc",
    "@vercel/cli-config",
    "xdg-app-paths",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
      {
        // The proxied Firebase iframe is embedded by MeeraDraw itself. Override
        // the app-wide anti-framing headers only for these helper resources.
        source: "/__/auth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Firebase option 3: keep redirect state first-party on Safari/iOS while
    // transparently serving Firebase's maintained sign-in helper.
    return firebaseAuthProxyRewrites(
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    );
  },
  async redirects() {
    // Les alias MeeraDraw (/studio→/dashboard, /profil, /acces) sont morts :
    // /studio est désormais l'écran du produit, les autres cibles n'existent plus.
    return [];
  },
  // Avoid Turbopack FS cache corruption (disk pressure) that can resolve
  // next/navigation to the react-server stub without useRouter/useParams.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default withWorkflow(nextConfig);
