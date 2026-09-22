import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { GameHistoryRecord } from '../models/game.models';
import type { User } from '../models/user.models';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly api = inject(ApiService);

  get(id: string): Observable<{ user: User }> {
    return this.api.get<{ user: User }>(`/users/${id}`);
  }

  /** Profile dashboard: the player, their recent games and the avatar choices. */
  profile(id: string): Observable<{ user: User; recentGames: GameHistoryRecord[]; avatars: string[] }> {
    return this.api.get<{ user: User; recentGames: GameHistoryRecord[]; avatars: string[] }>(`/users/${id}/profile`);
  }

  update(id: string, patch: { username?: string; avatar?: string }): Observable<{ user: User }> {
    return this.api.patch<{ user: User }>(`/users/${id}`, patch);
  }
}
