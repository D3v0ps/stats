import "server-only";

// One metric data source per request, reading through the signed-in user's client (RLS applies).
import { cache } from "react";
import { createSupabaseServerClient } from "./client-server";
import { SupabaseMetricDataSource } from "./repo/metrics";

export const getMetricSource = cache(async (): Promise<SupabaseMetricDataSource> => {
  return new SupabaseMetricDataSource(await createSupabaseServerClient());
});
