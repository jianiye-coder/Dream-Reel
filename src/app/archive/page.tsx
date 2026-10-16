import { sessionUserId } from "@/lib/session";
import { listDreamEntriesPage } from "@/lib/dreams";
import { redirect } from "next/navigation";
import ArchiveShell from "./ArchiveShell";

export default async function ArchivePage() {
  const userId = await sessionUserId();
  if (userId === null) {
    redirect("/login?callbackUrl=/archive");
  }

  let dataError = "";
  let entries: Awaited<ReturnType<typeof listDreamEntriesPage>>["entries"] = [];
  let nextCursor: string | null = null;

  try {
    const page = await listDreamEntriesPage(userId, { limit: 24 });
    entries = page.entries;
    nextCursor = page.nextCursor;
  } catch (error) {
    dataError =
      error instanceof Error
        ? error.message
        : "Could not read archive data. Showing empty state.";
  }

  return (
    <ArchiveShell
      entries={entries}
      nextCursor={nextCursor}
      dataError={dataError}
    />
  );
}
