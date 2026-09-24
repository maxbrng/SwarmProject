import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// A single-page artwork, so the sitemap is one entry — but having it (and pointing robots.txt at it)
// is what lets Search Console verify the domain and track the page properly.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
