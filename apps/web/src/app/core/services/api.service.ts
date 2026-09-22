import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * Single door to the Node API. Nothing in the app talks to JSON Server - that
 * stays behind the Node server, which is what lets it be swapped later.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  get<T>(path: string, params?: Params): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, { params: this.toParams(params) });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}${path}`, body ?? {});
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.base}${path}`);
  }

  private toParams(params?: Params): HttpParams {
    let result = new HttpParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== '') result = result.set(key, String(value));
    }
    return result;
  }
}
