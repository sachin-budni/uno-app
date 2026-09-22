import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let auth: jasmine.SpyObj<Pick<AuthService, 'login'>>;
  let router: Router;

  beforeEach(async () => {
    auth = jasmine.createSpyObj('AuthService', ['login']);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  const host = () => fixture.nativeElement as HTMLElement;

  it('starts with an invalid, untouched form', () => {
    expect(component.form.invalid).toBe(true);
    expect(host().querySelectorAll('.field-error').length).toBe(0);
  });

  it('does not call the server when the form is empty', () => {
    component.submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(component.form.controls.email.touched).toBe(true);
  });

  it('shows a message for an invalid email', () => {
    component.form.controls.email.setValue('not-an-email');
    component.form.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(host().textContent).toContain('Enter a valid email address.');
  });

  it('signs in and navigates to the lobby', async () => {
    const navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    auth.login.and.returnValue(
      of({
        accessToken: 'token',
        user: {
          id: 'u1',
          username: 'Sachin',
          avatar: 'fox',
          winRate: 0,
          createdAt: new Date().toISOString(),
          stats: {
            gamesPlayed: 0,
            gamesWon: 0,
            gamesLost: 0,
            unoCalls: 0,
            longestWinStreak: 0,
            currentWinStreak: 0,
            totalCardsPlayed: 0,
            totalPoints: 0,
          },
        },
      }),
    );

    component.form.setValue({ email: 'sachin@example.com', password: 'super-secret-1' });
    component.submit();

    expect(auth.login).toHaveBeenCalledWith('sachin@example.com', 'super-secret-1');
    expect(navigate).toHaveBeenCalledWith('/lobby');
  });

  it('shows friendly copy when the credentials are wrong', () => {
    auth.login.and.returnValue(throwError(() => ({ code: 'INVALID_CREDENTIALS', message: 'nope' })));

    component.form.setValue({ email: 'sachin@example.com', password: 'wrong-password' });
    component.submit();
    fixture.detectChanges();

    expect(component.serverError()).toBe('That email and password combination is not valid.');
    expect(host().querySelector('[role="alert"]')?.textContent).toContain('not valid');
    expect(component.loading()).toBe(false);
  });

  it('toggles password visibility', () => {
    const input = () => host().querySelector<HTMLInputElement>('#password')!;
    expect(input().type).toBe('password');

    component.showPassword.set(true);
    fixture.detectChanges();
    expect(input().type).toBe('text');
  });
});
