import { describe, expect, it } from "vitest";
import { DbError } from "@/lib/db/repo/shared";
import { EnvError } from "@/lib/db/env";
import {
  AddAliasInputSchema,
  DictionaryInputSchema,
  EnsureValuesInputSchema,
  FindPublishedInputSchema,
  SaveTemplateInputSchema,
  StageFactsInputSchema,
  StageLedgerInputSchema,
  UploadIdInputSchema,
} from "./action-schemas";
import { DUPLICATE_PUBLISH_ERROR, GENERIC_ERROR, actionErrorMessage } from "./errors";

const UUID = "6f1c2b8e-1d2a-4c3b-9e4f-0a1b2c3d4e5f";

describe("action input schemas", () => {
  it("accepts well-formed inputs", () => {
    expect(FindPublishedInputSchema.safeParse({ sha256s: ["a".repeat(64)] }).success).toBe(true);
    expect(DictionaryInputSchema.safeParse({ dimensions: ["kund", "konsult"] }).success).toBe(true);
    expect(UploadIdInputSchema.safeParse({ uploadId: UUID }).success).toBe(true);
    expect(
      AddAliasInputSchema.safeParse({ dimension: "kund", alias: "Postnord", valueId: 3 }).success,
    ).toBe(true);
    expect(
      EnsureValuesInputSchema.safeParse({ dimension: "kund", labels: ["Acme AB"], force: true })
        .success,
    ).toBe(true);
    expect(
      SaveTemplateInputSchema.safeParse({
        templateId: null,
        template: {
          datasetKey: "ip_timmar",
          name: "Timmar",
          headerSignature: ["kund"],
          version: 1,
          config: {
            kind: "table",
            columns: [],
            period: { kind: "per_upload" },
            company: { kind: "per_upload" },
          },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed or oversized inputs", () => {
    expect(FindPublishedInputSchema.safeParse({ sha256s: ["xyz"] }).success).toBe(false);
    expect(DictionaryInputSchema.safeParse({ dimensions: ["Kund!"] }).success).toBe(false);
    expect(UploadIdInputSchema.safeParse({ uploadId: "1; drop table" }).success).toBe(false);
    expect(
      EnsureValuesInputSchema.safeParse({ dimension: "kund", labels: [], force: false }).success,
    ).toBe(false);
    expect(
      EnsureValuesInputSchema.safeParse({ dimension: "kund", labels: [" "], force: false }).success,
    ).toBe(false);
    expect(
      AddAliasInputSchema.safeParse({ dimension: "kund", alias: "x", valueId: -1 }).success,
    ).toBe(false);
    expect(StageFactsInputSchema.safeParse({ uploadId: UUID, facts: [] }).success).toBe(false);
    const fact = {
      metricKey: "timmar",
      company: "MBAB",
      month: "2026-09",
      dims: { kund: 1 },
      value: 1,
      sourceRows: [2],
    };
    expect(StageFactsInputSchema.safeParse({ uploadId: UUID, facts: [fact] }).success).toBe(true);
    expect(
      StageFactsInputSchema.safeParse({
        uploadId: UUID,
        facts: [{ ...fact, dims: { kund: "Acme" } }],
      }).success,
    ).toBe(false);
    expect(
      StageFactsInputSchema.safeParse({ uploadId: UUID, facts: [{ ...fact, value: Infinity }] })
        .success,
    ).toBe(false);
    expect(
      StageLedgerInputSchema.safeParse({
        uploadId: UUID,
        rows: [
          {
            company: "MBAB",
            month: "2026-09",
            account: 999,
            dimNo: null,
            objectCode: null,
            amount: 1,
            yearOffset: 0,
            source: "psaldo",
          },
        ],
        accounts: [],
        objects: [],
      }).success,
    ).toBe(false);
  });
});

describe("actionErrorMessage", () => {
  it("passes Swedish database messages through", () => {
    expect(
      actionErrorMessage(
        new DbError("publish_upload", {
          message: "Uppladdningen är redan publicerad",
          code: "P0001",
        }),
      ),
    ).toBe("Uppladdningen är redan publicerad");
  });

  it("explains a duplicate publish", () => {
    expect(
      actionErrorMessage(
        new DbError("x", {
          message: "duplicate key value violates unique constraint",
          code: "23505",
        }),
      ),
    ).toBe(DUPLICATE_PUBLISH_ERROR);
  });

  it("hides technical messages", () => {
    expect(
      actionErrorMessage(
        new DbError("x", { message: "permission denied for table uploads", code: "42501" }),
      ),
    ).toBe(GENERIC_ERROR);
    expect(actionErrorMessage(new Error("fetch failed"))).toBe(GENERIC_ERROR);
    expect(actionErrorMessage("boom")).toBe(GENERIC_ERROR);
  });

  it("keeps configuration and repo messages", () => {
    expect(
      actionErrorMessage(new EnvError("MB Stats är inte konfigurerad: X saknas.", ["X"], [])),
    ).toContain("inte konfigurerad");
    expect(actionErrorMessage(new Error("Okänd datakälla: x"))).toBe("Okänd datakälla: x");
  });
});
