// Understands whatever a teacher pastes for a lesson video and returns one canonical value:
// a share link, an "open"/"uc"/"preview" link, or the full <iframe> embed code that Drive and YouTube offer.

// Pulls the src out of pasted embed code (<iframe src="…">); plain links pass through unchanged.
function embedSource(input: string) {
  const value = input.trim();
  return value.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&') || value;
}

// YouTube: watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/, youtube-nocookie embeds, or a bare 11-character id.
export function youtubeVideoId(input: string): string | null {
  const source = embedSource(input);
  const match = source.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})(?![\w-])/i);
  if (match) return match[1]!;
  return /^[\w-]{11}$/.test(source) ? source : null;
}

// Google Drive: /file/d/ID/(view|preview|edit), open?id=ID, uc?id=ID, embed code, or a bare file id.
// Stored as https://drive.google.com/file/d/ID/view (keeping resourcekey, which older shared files need).
export function googleDriveUrl(input: string): string | null {
  const source = embedSource(input);
  const fileId = source.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([\w-]{10,})/)?.[1] || (/^[\w-]{25,}$/.test(source) ? source : null);
  if (!fileId) return null;
  let resourceKey = '';
  try { resourceKey = new URL(source).searchParams.get('resourcekey') || ''; } catch {}
  return `https://drive.google.com/file/d/${fileId}/view${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ''}`;
}
