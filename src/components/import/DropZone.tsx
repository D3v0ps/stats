"use client";

import { FileUp } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { FILE_INPUT_ACCEPT } from "@/lib/import-ui/files";
import { cn } from "@/lib/utils";

/** Big drop area with a file picker; several files at once are fine. */
export function DropZone({
  onFiles,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      data-testid="drop-zone"
      data-over={over || undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-antracit-100 bg-card text-center transition-colors",
        compact ? "px-6 py-8" : "px-6 py-14 md:py-20",
        over && "border-bla bg-bla-100",
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-ljusgra-100 text-antracit-300 [&_svg]:size-7"
      >
        <FileUp />
      </div>
      <p className="text-base font-medium tracking-[0.06em] text-foreground uppercase">
        {over ? "Släpp filerna" : "Släpp månadens filer här"}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        Excel, CSV, text och SIE från Fortnox. Lägg gärna alla filer på en gång.
      </p>
      <Button
        type="button"
        size="lg"
        className="mt-1 px-5"
        onClick={() => input.current?.click()}
        data-testid="choose-files"
      >
        Välj filer
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Välj filer att ladda upp"
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}
