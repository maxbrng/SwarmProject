import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// The dev-only write endpoints are 403 in production anyway; keeping them out of the index stops
// them showing up in search results as dead pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
