import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideMessageSquare, LucideSend, LucideX } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { GameError } from '../../core/models/room.models';
import { NotificationService } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { AvatarComponent } from './avatar.component';

/**
 * Room chat. Messages are rendered as text (never as HTML) and the server has
 * already stripped markup, so there is no path from a message to the DOM.
 */
@Component({
  selector: 'app-chat-panel',
  imports: [FormsModule, AvatarComponent, LucideMessageSquare, LucideSend, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (collapsible() && !expanded()) {
      <button
        type="button"
        class="btn-secondary relative"
        (click)="expanded.set(true)"
        [attr.aria-label]="'Open chat, ' + rooms.messages().length + ' messages'"
      >
        <svg lucideMessageSquare class="h-4 w-4" aria-hidden="true"></svg>
        Chat
        @if (unread() > 0) {
          <span class="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-black text-ink-950">
            {{ unread() }}
          </span>
        }
      </button>
    } @else {
      <section class="panel flex h-full min-h-0 flex-col" aria-labelledby="chat-heading">
        <header class="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 id="chat-heading" class="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-ink-300">
            <svg lucideMessageSquare class="h-4 w-4" aria-hidden="true"></svg>
            Chat
          </h2>
          @if (collapsible()) {
            <button type="button" class="btn-ghost p-1.5" (click)="expanded.set(false)" aria-label="Close chat">
              <svg lucideX class="h-4 w-4" aria-hidden="true"></svg>
            </button>
          }
        </header>

        <div
          #scroller
          class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          @for (message of rooms.messages(); track message.id) {
            @if (message.system) {
              <p class="text-center text-xs italic text-ink-500">{{ message.text }}</p>
            } @else {
              <div class="flex items-start gap-2.5" [class.flex-row-reverse]="isMine(message.userId)">
                <app-avatar size="xs" [username]="message.username" [avatar]="message.avatar" />
                <div class="min-w-0 max-w-[80%]" [class.text-right]="isMine(message.userId)">
                  <p class="text-[11px] font-semibold text-ink-400">{{ message.username }}</p>
                  <p
                    class="mt-0.5 inline-block break-words rounded-xl px-3 py-1.5 text-sm"
                    [class]="isMine(message.userId) ? 'bg-brand-500/20 text-brand-100' : 'bg-white/5 text-ink-200'"
                  >
                    {{ message.text }}
                  </p>
                </div>
              </div>
            }
          } @empty {
            <p class="py-6 text-center text-sm text-ink-500">No messages yet. Say hello!</p>
          }
        </div>

        <form class="flex items-center gap-2 border-t border-white/5 p-3" (submit)="send($event)">
          <label class="sr-only" for="chat-input">Message</label>
          <input
            id="chat-input"
            class="input flex-1 py-2 text-sm"
            [(ngModel)]="draft"
            name="message"
            [maxlength]="maxLength"
            autocomplete="off"
            placeholder="Type message..."
          />
          <button type="submit" class="btn-primary px-3 py-2" [disabled]="!draft().trim()" aria-label="Send message">
            <svg lucideSend class="h-4 w-4" aria-hidden="true"></svg>
          </button>
        </form>
      </section>
    }
  `,
})
export class ChatPanelComponent {
  readonly rooms = inject(RoomService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);

  readonly collapsible = input(false, { transform: booleanAttribute });
  readonly maxLength = 240;

  readonly expanded = signal(true);
  readonly draft = signal('');
  readonly unread = signal(0);

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private seenCount = 0;

  constructor() {
    effect(() => {
      const messages = this.rooms.messages();

      if (this.collapsible() && !this.expanded()) {
        this.unread.set(Math.max(0, messages.length - this.seenCount));
        return;
      }

      this.seenCount = messages.length;
      this.unread.set(0);

      // Keep the newest message in view.
      const element = this.scroller()?.nativeElement;
      if (element) queueMicrotask(() => element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }));
    });
  }

  isMine(userId: string): boolean {
    return userId === this.auth.userId();
  }

  async send(event: Event): Promise<void> {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text) return;

    this.draft.set('');
    try {
      await this.rooms.sendMessage(text);
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Message not sent');
      this.draft.set(text);
    }
  }
}
