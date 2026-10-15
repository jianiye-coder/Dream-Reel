"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import type { DreamEntry } from "@/lib/dreams";
import { ArchiveBookSkeleton } from "./ArchiveBookSkeleton";
import type { ArchiveExporter, ArchiveTab } from "./DreamGrid";

const DreamGrid = dynamic(() => import("./DreamGrid"), {
  loading: () => <ArchiveBookSkeleton />,
});

function isArchiveTab(value: string | null): value is ArchiveTab {
  return value === "calendar" || value === "tags" || value === "recent";
}

export default function ArchiveShell({
  entries,
  nextCursor,
  dataError,
}: {
  entries: DreamEntry[];
  nextCursor: string | null;
  dataError: string;
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
}) {
  const { lang, T } = useLanguage();
  const { archive: A } = T;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const requestedTab = searchParams.get("tab");
  const activeTab: ArchiveTab = isArchiveTab(requestedTab) ? requestedTab : "calendar";

  function setActiveTab(tab: ArchiveTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "calendar") params.delete("tab");
    else params.set("tab", tab);
    const query = params.toString();
    // The native history API stays in sync with useSearchParams without re-running the server
    // page, so dreams loaded with "load more" and photos fetched for the open night survive a tab turn.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  async function exportAllDreams(format: "markdown" | "json") {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/dreams/export?format=${format}&lang=${lang}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(A.export.failed);

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `dream-reel-export-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      setExportError(A.export.failed);
    } finally {
      setExporting(false);
    }
  }

  const exporter: ArchiveExporter = {
    run: (format) => void exportAllDreams(format),
    busy: exporting,
    error: exportError,
  };

  return (
    <NotebookShell lean>
      <DreamGrid
        entries={entries}
        nextCursor={nextCursor}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        exporter={exporter}
        dataError={dataError}
      />
    </NotebookShell>
  );
}
