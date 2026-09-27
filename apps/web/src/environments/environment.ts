/**
 * Development defaults. The API and the Socket.IO server share an origin - the
 * client never talks to JSON Server directly.
 *
 * The host is taken from wherever the page was loaded, not hard-coded to
 * localhost, so opening http://192.168.1.5:4200 from a phone on the same
 * network reaches the API at http://192.168.1.5:3000 rather than looking for a
 * server on the phone itself.
 */
const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname || 'localhost';
const apiOrigin = `http://${host}:3000`;

export const environment = {
  production: false,
  apiUrl: `${apiOrigin}/api`,
  socketUrl: apiOrigin,
};
