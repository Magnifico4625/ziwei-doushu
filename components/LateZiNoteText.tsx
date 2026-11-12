const STAMP = /(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/;
const LABEL_BEFORE_STAMP = /(\(|（)[^\s()（）]{1,12}\s$/;

/**
 * ASCII hyphens in the late-Zi stamp are line-break opportunities.
 * Keep the date, and the short label glued to it, on one line.
 * The source note string is unchanged.
 */
export default function LateZiNoteText({ note }: { note: string }) {
  const match = STAMP.exec(note);
  if (!match || match.index === undefined) return note;

  let start = match.index;
  const label = LABEL_BEFORE_STAMP.exec(note.slice(0, start));
  if (label && label.index !== undefined) start = label.index;

  let end = match.index + match[0].length;
  const closer = note[end];
  if (closer === ')' || closer === '）') end += 1;

  const raw = note.slice(start, end);
  const glued = raw.replace(
    STAMP,
    (_, year: string, month: string, day: string, time: string) =>
      `${year}\u2011${month}\u2011${day}\u00A0${time}`,
  );

  return (
    <>
      {note.slice(0, start)}
      <span style={{ whiteSpace: 'nowrap' }}>{glued}</span>
      {note.slice(end)}
    </>
  );
}
