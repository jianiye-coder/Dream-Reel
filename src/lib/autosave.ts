export function shouldFlushLatestSave({
  pendingSave,
  pendingOptions,
  startedRevision,
  currentRevision,
}: {
  pendingSave: boolean;
  pendingOptions: boolean;
  startedRevision: number;
  currentRevision: number;
}) {
  return pendingSave || pendingOptions || currentRevision > startedRevision;
}
