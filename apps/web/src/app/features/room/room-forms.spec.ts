import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { CreateRoomComponent } from './create-room.component';
import { JoinRoomComponent } from './join-room.component';

const ROOM = {
  id: 'r1',
  code: 'A7K9P2',
  name: 'Friday Night',
  hostId: 'u1',
  maxPlayers: 4,
  mode: 'classic' as const,
  isPrivate: true,
  status: 'waiting' as const,
  players: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('CreateRoomComponent', () => {
  let fixture: ComponentFixture<CreateRoomComponent>;
  let component: CreateRoomComponent;
  let rooms: jasmine.SpyObj<Pick<RoomService, 'create'>>;
  let router: Router;

  beforeEach(async () => {
    rooms = jasmine.createSpyObj('RoomService', ['create']);
    rooms.create.and.resolveTo(ROOM);

    await TestBed.configureTestingModule({
      imports: [CreateRoomComponent],
      providers: [
        provideRouter([]),
        { provide: RoomService, useValue: rooms },
        { provide: SocketService, useValue: { isConnected: () => true } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateRoomComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('defaults to four seats, classic mode and private', () => {
    expect(component.form.getRawValue()).toEqual({
      name: '',
      maxPlayers: 4,
      mode: 'classic',
      isPrivate: true,
    });
  });

  it('refuses to submit without a room name', async () => {
    await component.submit();
    expect(rooms.create).not.toHaveBeenCalled();
    expect(component.form.controls.name.touched).toBe(true);
  });

  it('rejects a name that is too short', () => {
    component.form.controls.name.setValue('ab');
    expect(component.form.controls.name.invalid).toBe(true);
  });

  it('creates the room and opens it', async () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    component.form.patchValue({ name: 'Friday Night', maxPlayers: 2, mode: 'fast', isPrivate: false });

    await component.submit();

    expect(rooms.create).toHaveBeenCalledWith({
      name: 'Friday Night',
      maxPlayers: 2,
      mode: 'fast',
      isPrivate: false,
    });
    expect(navigate).toHaveBeenCalledWith(['/room', 'A7K9P2']);
  });

  it('offers exactly the supported seat counts', () => {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="radio"][aria-checked]');
    expect(component.playerCounts).toEqual([2, 3, 4]);
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('JoinRoomComponent', () => {
  let fixture: ComponentFixture<JoinRoomComponent>;
  let component: JoinRoomComponent;
  let rooms: jasmine.SpyObj<Pick<RoomService, 'join'>>;
  let router: Router;

  beforeEach(async () => {
    rooms = jasmine.createSpyObj('RoomService', ['join']);
    rooms.join.and.resolveTo(ROOM);

    await TestBed.configureTestingModule({
      imports: [JoinRoomComponent],
      providers: [
        provideRouter([]),
        { provide: RoomService, useValue: rooms },
        { provide: SocketService, useValue: { isConnected: () => true } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinRoomComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('rejects a code that is not six characters', () => {
    component.form.controls.roomCode.setValue('ABC');
    expect(component.form.invalid).toBe(true);

    component.form.controls.roomCode.setValue('A7K9P2');
    expect(component.form.valid).toBe(true);
  });

  it('upper-cases and strips punctuation as the player types', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#roomCode')!;
    input.value = 'a7k-9p2!!';
    component.normalize({ target: input } as unknown as Event);

    expect(input.value).toBe('A7K9P2');
    expect(component.form.controls.roomCode.value).toBe('A7K9P2');
  });

  it('joins and opens the waiting room', async () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    component.form.controls.roomCode.setValue('a7k9p2');

    await component.submit();

    expect(rooms.join).toHaveBeenCalledWith('A7K9P2');
    expect(navigate).toHaveBeenCalledWith(['/room', 'A7K9P2']);
  });

  it('surfaces a friendly message when the room is full', async () => {
    rooms.join.and.rejectWith({ code: 'ROOM_FULL', message: 'full' });
    component.form.controls.roomCode.setValue('A7K9P2');

    await component.submit();
    fixture.detectChanges();

    expect(component.serverError()).toBe('That room is already full.');
  });

  it('surfaces a friendly message for an unknown code', async () => {
    rooms.join.and.rejectWith({ code: 'ROOM_NOT_FOUND', message: 'nope' });
    component.form.controls.roomCode.setValue('ZZZZZZ');

    await component.submit();

    expect(component.serverError()).toBe('No open room matches that code.');
  });
});
