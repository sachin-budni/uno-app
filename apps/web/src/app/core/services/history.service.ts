import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { GameHistoryRecord } from '../models/game.models';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly api = inject(ApiService);

  list(limit = 20): Observable<{ games: GameHistoryRecord[] }> {
    return this.api.get<{ games: GameHistoryRecord[] }>('/game-history', { limit });
  }

  get(id: string): Observable<{ game: GameHistoryRecord }> {
    return this.api.get<{ game: GameHistoryRecord }>(`/game-history/${id}`);
  }
}
