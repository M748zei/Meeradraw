import type { NextConfig } from "next";

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

export default nextConfig;
