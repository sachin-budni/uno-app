import { Pipe, type PipeTransform } from '@angular/core';

/** 185000 -> "3m 05s". Used for game durations. */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(milliseconds: number | null | undefined): string {
    if (!milliseconds || milliseconds < 0) return '0s';
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
}

/** An ISO date -> "just now", "12 min ago", "3 days ago", or a date. */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    if (!value) return '';
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) return '';

    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86_400) {
      const hours = Math.round(seconds / 3600);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    if (seconds < 7 * 86_400) {
      const days = Math.round(seconds / 86_400);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}

/** Clock formatting for the turn timer: 29 -> "00:29". */
@Pipe({ name: 'clock' })
export class ClockPipe implements PipeTransform {
  transform(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return '--:--';
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }
}
