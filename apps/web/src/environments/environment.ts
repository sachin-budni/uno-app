/**
 * Development defaults. The Node API and the Socket.IO server are the same
 * origin - the client never talks to JSON Server directly.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  socketUrl: 'http://localhost:3000',
};
