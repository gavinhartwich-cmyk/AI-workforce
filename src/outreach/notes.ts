/**
 * Appends a timestamped line to a company's freeform `notes` field
 * (SPEC.md §32: "record decisions") rather than overwriting it — every
 * prior note (including anything Gavin typed by hand in hartwich-os)
 * stays intact. Pure function; the write-store does the read-modify-write.
 */
export function appendNote(existingNotes: string | null, newNote: string, at: Date = new Date()): string {
  const line = `[${at.toISOString()}] ${newNote}`;
  return existingNotes ? `${existingNotes}\n${line}` : line;
}
