import { auth } from "@/auth";
import { getWeeklyRecap, listDreamEntriesPage } from "@/lib/dreams";
import { redirect } from "next/navigation";
import ArchiveShell from "./ArchiveShell";

export default async function ArchivePage() {
  const session = await auth();
  const rawId = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
  const userId = Number.isInteger(rawId) && rawId > 0 ? rawId : undefined;
  if (!userId) {
    redirect("/login?callbackUrl=/archive");
  }

  let dataError = "";
  let recap = {
    weekStart: new Date().toISOString(),
    entryCount: 0,
    topMoods: [] as { item: string; count: number }[],
    topPeople: [] as { item: string; count: number }[],
    topLocations: [] as { item: string; count: number }[],
    topSymbols: [] as { item: string; count: number }[],
    stressByMood: [] as unknown[],
  };
  let entries: Awaited<ReturnType<typeof listDreamEntriesPage>>["entries"] = [];
  let nextCursor: string | null = null;

  try {
    const [weeklyRecap, page] = await Promise.all([
      getWeeklyRecap(userId),
      listDreamEntriesPage(userId, { limit: 24 }),
    ]);
    recap = weeklyRecap;
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
      recap={recap}
      dataError={dataError}
      user={session?.user ?? null}
    />
  );
}
