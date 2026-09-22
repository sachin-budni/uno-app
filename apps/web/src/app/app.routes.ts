import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';

/**
 * Every feature is lazily loaded, so the sign-in screen ships a small bundle and
 * the game table only arrives when a player actually sits down.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'lobby' },

  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in - UNO Arena',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create account - UNO Arena',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },

  {
    path: 'lobby',
    canActivate: [authGuard],
    title: 'Lobby - UNO Arena',
    loadComponent: () => import('./features/lobby/lobby.component').then((m) => m.LobbyComponent),
  },

  {
    path: 'room/create',
    canActivate: [authGuard],
    title: 'Create a room - UNO Arena',
    loadComponent: () => import('./features/room/create-room.component').then((m) => m.CreateRoomComponent),
  },
  {
    path: 'room/join',
    canActivate: [authGuard],
    title: 'Join a room - UNO Arena',
    loadComponent: () => import('./features/room/join-room.component').then((m) => m.JoinRoomComponent),
  },
  {
    path: 'room/:roomCode',
    canActivate: [authGuard],
    title: 'Waiting room - UNO Arena',
    loadComponent: () => import('./features/room/room.component').then((m) => m.RoomComponent),
  },

  {
    path: 'game/:gameId',
    canActivate: [authGuard],
    title: 'Game - UNO Arena',
    loadComponent: () => import('./features/game/game.component').then((m) => m.GameComponent),
  },

  {
    path: 'profile',
    canActivate: [authGuard],
    title: 'Profile - UNO Arena',
    loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'history',
    canActivate: [authGuard],
    title: 'Game history - UNO Arena',
    loadComponent: () => import('./features/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'history/:id',
    canActivate: [authGuard],
    title: 'Game detail - UNO Arena',
    loadComponent: () => import('./features/history/history-detail.component').then((m) => m.HistoryDetailComponent),
  },
  {
    path: 'leaderboard',
    canActivate: [authGuard],
    title: 'Leaderboard - UNO Arena',
    loadComponent: () => import('./features/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
  },

  {
    path: '404',
    title: 'Not found - UNO Arena',
    loadComponent: () => import('./features/not-found.component').then((m) => m.NotFoundComponent),
  },
  { path: '**', redirectTo: '404' },
];
