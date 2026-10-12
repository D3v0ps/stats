import type { MetadataRoute } from "next";

// Private app: nothing may be crawled (pages also send noindex via metadata and headers).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
