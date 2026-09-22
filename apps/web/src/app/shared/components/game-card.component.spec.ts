import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Card } from '../../core/models/game.models';
import { GameCardComponent } from './game-card.component';

const red7: Card = { id: 'c1', color: 'red', type: 'number', value: 7 };
const wild4: Card = { id: 'c2', color: 'wild', type: 'wild_draw4' };
const blueSkip: Card = { id: 'c3', color: 'blue', type: 'skip' };

describe('GameCardComponent', () => {
  let fixture: ComponentFixture<GameCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GameCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(GameCardComponent);
  });

  const host = () => fixture.nativeElement as HTMLElement;

  it('renders the number on a number card', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.detectChanges();

    expect(host().textContent).toContain('7');
  });

  it('renders +4 for a wild draw four', () => {
    fixture.componentRef.setInput('card', wild4);
    fixture.detectChanges();

    expect(host().textContent).toContain('+4');
  });

  it('gives every card a meaningful accessible label', () => {
    fixture.componentRef.setInput('card', blueSkip);
    fixture.detectChanges();

    const element = host().querySelector('[aria-label]');
    expect(element?.getAttribute('aria-label')).toBe('Blue Skip card');
  });

  it('says whether a selectable card is playable', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();
    expect(host().querySelector('button')?.getAttribute('aria-label')).toBe('Red 7 card, playable');

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(host().querySelector('button')?.getAttribute('aria-label')).toBe('Red 7 card, not playable');
  });

  it('is a button only when it can be selected', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.detectChanges();
    expect(host().querySelector('button')).toBeNull();

    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();
    expect(host().querySelector('button')).not.toBeNull();
  });

  it('emits the card when picked', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();

    let picked: Card | undefined;
    fixture.componentInstance.pick.subscribe((card) => (picked = card));
    host().querySelector('button')!.click();

    expect(picked).toEqual(red7);
  });

  it('does not emit when disabled', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.componentRef.setInput('selectable', true);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const spy = jasmine.createSpy('pick');
    fixture.componentInstance.pick.subscribe(spy);
    host().querySelector('button')!.click();

    expect(spy).not.toHaveBeenCalled();
  });

  it('never reveals a face when shown face down', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.componentRef.setInput('faceDown', true);
    fixture.detectChanges();

    expect(host().textContent).not.toContain('7');
    expect(host().textContent).toContain('UNO');
  });

  it('marks the selected card for assistive tech', () => {
    fixture.componentRef.setInput('card', red7);
    fixture.componentRef.setInput('selectable', true);
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();

    expect(host().querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  });
});
