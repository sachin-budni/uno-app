import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { LeaderboardEntry, LeaderboardWindow } from '../models/user.models';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private readonly api = inject(ApiService);

  get(window: LeaderboardWindow = 'all', limit = 50): Observable<{ window: LeaderboardWindow; entries: LeaderboardEntry[] }> {
    return this.api.get<{ window: LeaderboardWindow; entries: LeaderboardEntry[] }>('/leaderboard', { window, limit });
  }
}
