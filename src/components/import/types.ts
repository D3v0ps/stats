import type { DatasetKind, MetricKind, Unit } from "@/lib/contracts";
import type { UploadAccountGroup } from "@/lib/import-ui/budget";

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
  /** Account groups (settings): budget signs and the summary-line warning in the review. */
  accountGroups: UploadAccountGroup[];
}
