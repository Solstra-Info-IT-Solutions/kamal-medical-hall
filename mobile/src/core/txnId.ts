/**
 * Finds the transaction / reference number in the text read from a payment screenshot (GPay, PhonePe, Paytm, BHIM,
 * bank apps). Pure text in, one candidate out, so it is unit-tested with real-looking screens.
 */
const LABELS = /(upi\s*(?:ref(?:erence)?|transaction)\s*(?:no\.?|number|id)?|utr(?:\s*(?:no\.?|number))?|transaction\s*(?:id|ref(?:erence)?(?:\s*(?:no\.?|number|id))?)|ref(?:erence)?\s*(?:no\.?|number|id)|txn\s*(?:id|no\.?)|rrn)/i;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9\-_/]{7,38}/g;

/** OCR often reads 0 as O (and 1 as I or l) inside a long number. */
const fixDigits = (t: string) => (/^[\dOoIl]{9,}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 8 ? t.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : t);

/** A 12-digit UTR is the most trustworthy; long alphanumeric ids (PhonePe "T24...") come next. */
function score(token: string): number {
  if (/^\d{12}$/.test(token)) return 100;
  if (/^[Tt]\d{14,30}$/.test(token)) return 90;
  if (/^\d{9,22}$/.test(token)) return 70;
  if (/^[A-Za-z0-9]{12,30}$/.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token)) return 50;
  return 0;
}

export function extractTransactionId(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candidates: { token: string; s: number }[] = [];
  const add = (text: string, bonus: number) => { for (const raw of text.match(TOKEN) ?? []) { const m = fixDigits(raw); const s = score(m); if (s) candidates.push({ token: m, s: s + bonus }); } };

  lines.forEach((line, i) => {
    const m = LABELS.exec(line);
    if (!m) return;
    const after = line.slice(m.index + m[0].length);
    add(after, 30);                       // "UPI Ref No: 4123..." on the same line
    if (!/[A-Za-z0-9]{8,}/.test(after) && lines[i + 1]) add(lines[i + 1]!, 25); // label on one line, value on the next
  });
  if (!candidates.length) for (const line of lines) add(line, 0); // no label found: any plausible long number
  candidates.sort((a, b) => b.s - a.s);
  return candidates[0]?.token ?? null;
}
