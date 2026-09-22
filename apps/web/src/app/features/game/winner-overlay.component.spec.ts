import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { GameFinishedPayload } from '../../core/models/game.models';
import { WinnerOverlayComponent } from './winner-overlay.component';

const RESULT: GameFinishedPayload = {
  gameId: 'g1',
  winnerId: 'me',
  winnerUsername: 'Sachin',
  durationMs: 185_000,
  results: [
    { id: 'p2', username: 'Rahul', cardsLeft: 3, points: 34, cardsPlayed: 6, unoCalls: 0, isWinner: false },
    { id: 'me', username: 'Sachin', cardsLeft: 0, points: 0, cardsPlayed: 9, unoCalls: 2, isWinner: true },
    { id: 'p3', username: 'Anil', cardsLeft: 1, points: 12, cardsPlayed: 8, unoCalls: 1, isWinner: false },
  ],
};

describe('WinnerOverlayComponent', () => {
  let fixture: ComponentFixture<WinnerOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WinnerOverlayComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(WinnerOverlayComponent);
  });

  const host = () => fixture.nativeElement as HTMLElement;

  it('renders nothing until a game finishes', () => {
    fixture.detectChanges();
    expect(host().querySelector('[role="dialog"]')).toBeNull();
  });

  it('announces the winner', () => {
    fixture.componentRef.setInput('result', RESULT);
    fixture.componentRef.setInput('myPlayerId', 'me');
    fixture.detectChanges();

    expect(host().querySelector('#winner-title')?.textContent).toContain('Sachin');
    expect(host().textContent).toContain('You won the game!');
    expect(host().textContent).toContain('3m 05s');
  });

  it('tells a losing player they lost', () => {
    fixture.componentRef.setInput('result', RESULT);
    fixture.componentRef.setInput('myPlayerId', 'p2');
    fixture.detectChanges();

    expect(fixture.componentInstance.iWon()).toBe(false);
    expect(host().textContent).toContain('Better luck next round.');
  });

  it('puts the winner at the top and sorts the rest by points left', () => {
    fixture.componentRef.setInput('result', RESULT);
    fixture.detectChanges();

    expect(fixture.componentInstance.ranked().map((player) => player.id)).toEqual(['me', 'p3', 'p2']);
  });

  it('scores the winner with everyone else"s remaining cards', () => {
    fixture.componentRef.setInput('result', RESULT);
    fixture.detectChanges();

    expect(fixture.componentInstance.winnerPoints()).toBe(46);
  });

  it('emits playAgain from the rematch button', () => {
    fixture.componentRef.setInput('result', RESULT);
    fixture.componentRef.setInput('myPlayerId', 'me');
    fixture.detectChanges();

    const spy = jasmine.createSpy('playAgain');
    fixture.componentInstance.playAgain.subscribe(spy);

    const button = Array.from(host().querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Play again'),
    );
    button!.click();

    expect(spy).toHaveBeenCalled();
  });

  it('handles an abandoned game with no winner', () => {
    fixture.componentRef.setInput('result', { ...RESULT, winnerId: null, winnerUsername: null });
    fixture.detectChanges();

    expect(host().textContent).toContain('No winner');
    expect(host().textContent).toContain('Everyone left the table.');
  });
});
