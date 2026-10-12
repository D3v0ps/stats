import type { DatasetKind, MetricKind, Unit } from "@/lib/contracts";

/** Catalog data the upload page needs (serializable; built by the server page). */
export interface UploadCatalog {
  datasets: { key: string; name: string; kind: DatasetKind; dimensions: string[] }[];
  metrics: {
    key: string;
    name: string;
    unit: Unit;
    kind: MetricKind;
    datasetKey: string | null;
    higherIsBetter: boolean | null;
    decimals: number | null;
  }[];
  dimensions: { key: string; label: string; personal: boolean }[];
}
