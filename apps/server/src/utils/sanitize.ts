const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Chat is rendered as text by Angular (interpolation, never innerHTML), but the
 * server still strips control characters and escapes markup so that a stored
 * message can never become active content in any future consumer.
 */
export function sanitizeText(input: string, maxLength: number): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Usernames: visible characters only, collapsed whitespace, no markup. */
export function sanitizeUsername(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** Only allow avatars we can safely render: a short seed key, not an arbitrary URL. */
export function sanitizeAvatar(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}
