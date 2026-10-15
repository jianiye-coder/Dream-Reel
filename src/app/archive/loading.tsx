"use client";

import { NotebookShell } from "@/components/notebook/NotebookShell";
import { ArchiveBookSkeleton } from "./ArchiveBookSkeleton";

export default function ArchiveLoading() {
  return (
    <NotebookShell lean>
      <ArchiveBookSkeleton />
    </NotebookShell>
  );
}
