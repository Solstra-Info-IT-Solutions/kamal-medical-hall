/** Helpers for the "any kind of file" uploads (prescriptions from customers, bills from the store). */

const BLOCKED = /\.(exe|bat|cmd|com|msi|apk|aab|sh|bash|js|mjs|jar|scr|vbs|ps1|dll|dmg|pkg|app|lnk|reg)$/i;
export const isBlockedName = (name: string) => BLOCKED.test(name.trim());

export const isImageMime = (mime?: string | null) => !!mime && mime.toLowerCase().startsWith('image/');

const BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
};

/** The file's mime type, falling back to its extension when the picker did not report one. */
export function guessMime(name: string, given?: string | null) {
  if (given && given !== 'application/octet-stream') return given.toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXT[ext] ?? 'application/octet-stream';
}

/** Short badge text for a non-image file, e.g. "PDF", "DOCX". */
export const fileBadge = (name: string, mime?: string | null) => (mime === 'application/pdf' ? 'PDF' : (name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase());
