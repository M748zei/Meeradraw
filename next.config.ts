import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

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
  serverExternalPackages: ["firebase-admin"],
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
    ];
  },
  async redirects() {
    // Friendly aliases people type or old links share.
    return [
      { source: "/create", destination: "/universes/new", permanent: false },
      { source: "/studio", destination: "/dashboard", permanent: false },
      { source: "/profil", destination: "/profile", permanent: false },
      { source: "/acces", destination: "/license", permanent: false },
    ];
  },
  // Avoid Turbopack FS cache corruption (disk pressure) that can resolve
  // next/navigation to the react-server stub without useRouter/useParams.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default withWorkflow(nextConfig);
