import { ClockPipe, DurationPipe, TimeAgoPipe } from './format.pipes';

describe('DurationPipe', () => {
  const pipe = new DurationPipe();

  it('formats seconds under a minute', () => {
    expect(pipe.transform(42_000)).toBe('42s');
  });

  it('formats minutes and pads the seconds', () => {
    expect(pipe.transform(185_000)).toBe('3m 05s');
  });

  it('copes with nothing', () => {
    expect(pipe.transform(null)).toBe('0s');
    expect(pipe.transform(-5)).toBe('0s');
  });
});

describe('ClockPipe', () => {
  const pipe = new ClockPipe();

  it('formats a turn timer', () => {
    expect(pipe.transform(29)).toBe('00:29');
    expect(pipe.transform(95)).toBe('01:35');
    expect(pipe.transform(0)).toBe('00:00');
  });

  it('shows placeholders when there is no clock', () => {
    expect(pipe.transform(null)).toBe('--:--');
  });

  it('never shows a negative clock', () => {
    expect(pipe.transform(-3)).toBe('00:00');
  });
});

describe('TimeAgoPipe', () => {
  const pipe = new TimeAgoPipe();

  it('says "just now" for something that happened seconds ago', () => {
    expect(pipe.transform(new Date(Date.now() - 5_000).toISOString())).toBe('just now');
  });

  it('counts minutes and hours', () => {
    expect(pipe.transform(new Date(Date.now() - 12 * 60_000).toISOString())).toBe('12 min ago');
    expect(pipe.transform(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3 hours ago');
  });

  it('counts days, singular and plural', () => {
    expect(pipe.transform(new Date(Date.now() - 24 * 3_600_000).toISOString())).toBe('1 day ago');
    expect(pipe.transform(new Date(Date.now() - 3 * 24 * 3_600_000).toISOString())).toBe('3 days ago');
  });

  it('returns an empty string for nothing', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform('not-a-date')).toBe('');
  });
});
