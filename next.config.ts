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
  // Avoid Turbopack FS cache corruption (disk pressure) that can resolve
  // next/navigation to the react-server stub without useRouter/useParams.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
