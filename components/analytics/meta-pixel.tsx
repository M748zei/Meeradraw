"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

type MetaEventParams = Record<string, string | number | boolean | string[] | undefined>;

declare global {
  interface Window {
    fbq?: {
      (...args: unknown[]): void;
      callMethod?: (...args: unknown[]) => void;
      queue?: unknown[];
      loaded?: boolean;
      version?: string;
      push?: (...args: unknown[]) => void;
    };
    _fbq?: Window["fbq"];
  }
}

export function trackMetaEvent(
  eventName: "ViewContent" | "InitiateCheckout" | "Purchase" | string,
  params?: MetaEventParams,
  options?: { eventID?: string }
) {
  if (!PIXEL_ID || typeof window === "undefined" || !window.fbq) return;
  if (options?.eventID) {
    window.fbq("track", eventName, params ?? {}, { eventID: options.eventID });
    return;
  }
  window.fbq("track", eventName, params ?? {});
}

function RouteTracking() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialPageViewSent = useRef(false);

  useEffect(() => {
    if (!window.fbq) return;

    if (initialPageViewSent.current) {
      window.fbq("track", "PageView");
    } else {
      initialPageViewSent.current = true;
    }

    if (pathname === "/") {
      trackMetaEvent("ViewContent", {
        content_name: "MeeraDraw",
        content_category: "SaaS de livres de coloriage",
        content_type: "product",
      });
    }
  }, [pathname, searchParams]);

  return null;
}

export function MetaPixel() {
  if (!PIXEL_ID) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <Suspense fallback={null}>
        <RouteTracking />
      </Suspense>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
