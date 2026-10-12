"use client";

// Orchestration of the upload queue: reads dropped files in the ingest worker,
// recognizes them against the saved templates, runs known templates as soon as
// their choices are complete, and keeps the dimension dictionaries the review
// and the lookup step need. State transitions live in the pure queue reducer.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { UploadChoices } from "@/lib/contracts";
import { diffSignature } from "@/lib/ingest/recognize";
import { findDuplicate, type PublishedFile } from "@/lib/db/repo/import-extra";
import type { StoredTemplate } from "@/lib/db/repo/templates";
import { classifyFileName, fileProblem } from "@/lib/import-ui/files";
import { todayInStockholm } from "@/lib/import-ui/months";
import {
  newQueueItem,
  queueReducer,
  requiredChoices,
  runToken,
  templateRef,
  type JobOutcome,
  type QueueItem,
} from "@/lib/import-ui/queue";
import { planJobs, templateHints, toRecognitionTemplate } from "@/lib/import-ui/recognition";
import { aliasTablesFromDictionary, type DictionaryEntry } from "@/lib/import-ui/review";
import { lookupDimensions } from "@/lib/import-ui/steps";
import { findPublishedAction, loadDictionariesAction } from "@/app/(app)/ladda-upp/actions";
import { createIngestClient, type IngestClient } from "./ingest-client";

export interface ImportQueue {
  items: QueueItem[];
  templates: StoredTemplate[];
  client: () => IngestClient;
  addFiles(files: readonly File[]): void;
  setChoices(id: string, choices: UploadChoices): void;
  remove(id: string): void;
  getDictionaries(keys: readonly string[]): Promise<Record<string, DictionaryEntry>>;
  rememberValues(dimension: string, entry: DictionaryEntry): void;
  templateSaved(itemId: string, template: StoredTemplate, headerRow?: number): void;
  markPublished(id: string, summary: string, publishedAt: string): void;
}

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `f${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}

export function useImportQueue(initialTemplates: StoredTemplate[]): ImportQueue {
  const [items, dispatch] = useReducer(queueReducer, []);
  const [templates, setTemplates] = useState(initialTemplates);
  const templatesRef = useRef(templates);
  const itemsRef = useRef(items);
  const clientRef = useRef<IngestClient | null>(null);
  const dictionaries = useRef<Record<string, DictionaryEntry>>({});
  const runs = useRef(new Map<string, string>());

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const client = useCallback((): IngestClient => {
    clientRef.current ??= createIngestClient();
    return clientRef.current;
  }, []);

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  const getDictionaries = useCallback(async (keys: readonly string[]) => {
    const missing = [...new Set(keys)].filter((k) => !(k in dictionaries.current));
    if (missing.length > 0) {
      const res = await loadDictionariesAction({ dimensions: missing });
      if (!res.ok) throw new Error(res.error);
      dictionaries.current = { ...dictionaries.current, ...res.data };
    }
    const out: Record<string, DictionaryEntry> = {};
    for (const k of keys) {
      const entry = dictionaries.current[k];
      if (entry) out[k] = entry;
    }
    return out;
  }, []);

  const rememberValues = useCallback((dimension: string, entry: DictionaryEntry) => {
    dictionaries.current = { ...dictionaries.current, [dimension]: entry };
  }, []);

  const published = useCallback(async (sha256: string): Promise<PublishedFile[]> => {
    const res = await findPublishedAction({ sha256s: [sha256] });
    return res.ok ? res.data : [];
  }, []);

  const readFile = useCallback(
    async (id: string, file: File) => {
      const problem = fileProblem(file);
      if (problem) {
        const unsupported = classifyFileName(file.name) !== "spreadsheet";
        dispatch(
          unsupported
            ? { type: "unsupported", id, message: problem }
            : { type: "failed", id, message: problem },
        );
        return;
      }
      const ingest = client();
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        dispatch({ type: "failed", id, message: "Filen kunde inte öppnas." });
        return;
      }
      const read = await ingest.call({ op: "read", fileId: id, fileName: file.name, bytes });
      if (!read.ok) {
        dispatch({ type: "failed", id, message: read.error });
        return;
      }
      dispatch({ type: "read", id, sha256: read.sha256, format: read.format });
      if (read.format === "pdf") {
        dispatch({
          type: "unsupported",
          id,
          message: fileProblem({ name: "x.pdf", size: 1 }) ?? "",
        });
        return;
      }
      const already = await published(read.sha256);

      if (read.sie) {
        dispatch({ type: "sie_ready", id, result: read.sie });
        const dup = findDuplicate(already, {
          datasetKey: read.sie.datasetKey,
          sha256: read.sha256,
          templateId: null,
          templateVersion: null,
        });
        if (dup) dispatch({ type: "duplicate", id, publishedAt: dup.publishedAt });
        return;
      }

      const stored = templatesRef.current;
      const recognitionTemplates = stored.map(toRecognitionTemplate);
      const rec = await ingest.call({
        op: "recognize",
        fileId: id,
        hints: templateHints(recognitionTemplates),
        today: todayInStockholm(new Date()),
      });
      if (!rec.ok) {
        dispatch({ type: "failed", id, message: rec.error });
        return;
      }
      const jobs = planJobs({
        defaultSheet: rec.defaultSheet,
        sheetForHint: rec.sheetForHint,
        signatures: Object.fromEntries(
          Object.entries(rec.sheets).map(([k, v]) => [k, v.signature]),
        ),
        sheetOrder: read.sheets.map((s) => s.name),
        templates: recognitionTemplates,
      });
      const outcomes: JobOutcome[] = jobs.map((job) => {
        const summary = rec.sheets[job.sheetName]!;
        const base = {
          sheetName: job.sheetName,
          signature: summary.signature,
          suggestions: {
            period: summary.periodSuggestions,
            company: summary.companySuggestion,
            asOfDate: summary.asOfSuggestion,
          },
        };
        if (job.kind === "new") return { ...base, kind: "new" };
        const t = stored.find((x) => x.id === job.template.id)!;
        if (job.kind === "drift")
          return { ...base, kind: "drift", template: templateRef(t), diff: job.diff };
        return {
          ...base,
          kind: "known",
          template: templateRef(t),
          requires: requiredChoices(t.config),
        };
      });
      dispatch({ type: "recognized", id, jobs: outcomes });
      outcomes.forEach((o, k) => {
        if (o.kind !== "known") return;
        const dup = findDuplicate(already, {
          datasetKey: o.template.datasetKey,
          sha256: read.sha256,
          templateId: o.template.id,
          templateVersion: o.template.version,
        });
        if (dup)
          dispatch({
            type: "duplicate",
            id: k === 0 ? id : `${id}:${k}`,
            publishedAt: dup.publishedAt,
          });
      });
    },
    [client, published],
  );

  const processFile = useCallback(
    async (file: File) => {
      const id = newId();
      dispatch({ type: "add", items: [newQueueItem(id, file)] });
      try {
        await readFile(id, file);
      } catch {
        // A lost connection or an unexpected failure must not leave the card at "Läser…".
        dispatch({ type: "failed", id, message: "Filen kunde inte läsas. Försök igen." });
      }
    },
    [readFile],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      for (const f of files) void processFile(f);
    },
    [processFile],
  );

  // Run known templates whenever an item is waiting to run with a new set of choices.
  useEffect(() => {
    for (const item of items) {
      if (item.status !== "running" || !item.template) continue;
      const token = runToken(item);
      if (runs.current.get(item.id) === token) continue;
      runs.current.set(item.id, token);
      void (async () => {
        const finish = (action: Parameters<typeof dispatch>[0]) => {
          if (runs.current.get(item.id) !== token) return;
          runs.current.delete(item.id);
          dispatch(action);
        };
        const template = templatesRef.current.find((t) => t.id === item.template!.id);
        if (!template) {
          finish({ type: "failed", id: item.id, message: "Mallen finns inte längre." });
          return;
        }
        try {
          const dims =
            template.config.kind === "sie" ? [] : lookupDimensions(template.config.steps);
          const aliases = aliasTablesFromDictionary(await getDictionaries(dims));
          const res = await client().call({
            op: "apply",
            fileId: item.fileId,
            template,
            choices: item.choices,
            aliases,
            ...(item.headerRow !== undefined ? { headerRow: item.headerRow } : {}),
          });
          finish(
            res.ok
              ? { type: "run_done", id: item.id, result: res.result }
              : { type: "failed", id: item.id, message: res.error },
          );
        } catch (error) {
          finish({
            type: "failed",
            id: item.id,
            message: error instanceof Error ? error.message : "Filen kunde inte läsas.",
          });
        }
      })();
    }
  }, [items, client, getDictionaries]);

  const setChoices = useCallback((id: string, choices: UploadChoices) => {
    dispatch({ type: "set_choices", id, choices });
  }, []);

  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    dispatch({ type: "remove", id });
    if (item && !itemsRef.current.some((i) => i.id !== id && i.fileId === item.fileId)) {
      void clientRef.current?.call({ op: "release", fileId: item.fileId });
    }
  }, []);

  const templateSaved = useCallback(
    (itemId: string, template: StoredTemplate, headerRow?: number) => {
      setTemplates((list) => [...list.filter((t) => t.id !== template.id), template]);
      templatesRef.current = [
        ...templatesRef.current.filter((t) => t.id !== template.id),
        template,
      ];
      const ref = templateRef(template);
      const requires = requiredChoices(template.config);
      dispatch({ type: "template_saved", id: itemId, template: ref, requires, headerRow });
      // Other dropped files of the same new (or changed) report type run with it right away.
      for (const other of itemsRef.current) {
        if (
          other.id === itemId ||
          (other.status !== "new" && other.status !== "drift") ||
          !other.signature
        )
          continue;
        if (template.sheetHint && other.sourceSheet && other.sourceSheet !== template.sheetHint)
          continue;
        if (diffSignature(template.headerSignature, other.signature).compatible) {
          dispatch({ type: "template_saved", id: other.id, template: ref, requires });
        }
      }
    },
    [],
  );

  const markPublished = useCallback((id: string, summary: string, publishedAt: string) => {
    dispatch({ type: "published", id, summary, publishedAt });
  }, []);

  return useMemo(
    () => ({
      items,
      templates,
      client,
      addFiles,
      setChoices,
      remove,
      getDictionaries,
      rememberValues,
      templateSaved,
      markPublished,
    }),
    [
      items,
      templates,
      client,
      addFiles,
      setChoices,
      remove,
      getDictionaries,
      rememberValues,
      templateSaved,
      markPublished,
    ],
  );
}
