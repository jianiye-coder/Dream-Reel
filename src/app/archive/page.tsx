import { auth } from "@/auth";
import { getWeeklyRecap, listDreamEntries } from "@/lib/dreams";
import ArchiveShell from "./ArchiveShell";

export default async function ArchivePage() {
  const session = await auth();
  const rawId = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
  const userId = isNaN(rawId) ? undefined : rawId;

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
  let entries: Awaited<ReturnType<typeof listDreamEntries>> = [];

  try {
    [recap, entries] = await Promise.all([
      getWeeklyRecap(userId),
      listDreamEntries(10000, userId),
    ]);
  } catch (error) {
    dataError =
      error instanceof Error
        ? error.message
        : "Could not read archive data. Showing empty state.";
  }

  return (
    <ArchiveShell
      entries={entries}
      recap={recap}
      dataError={dataError}
      user={session?.user ?? null}
    />
  );
}
