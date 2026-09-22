/**
 * Production defaults: same-origin, so a reverse proxy can serve the built
 * client and forward /api and /socket.io to the Node server.
 */
export const environment = {
  production: true,
  apiUrl: '/api',
  socketUrl: window.location.origin,
};
