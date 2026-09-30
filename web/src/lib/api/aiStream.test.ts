import { describe, expect, it } from 'vitest';
import { SseParser } from './aiStream';

describe('SseParser', () => {
  it('parses complete SSE events', () => {
    const parser = new SseParser();
    const events = parser.push('event: status\ndata: {"label":"Looking up workouts"}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('status');
    expect(events[0].data).toBe('{"label":"Looking up workouts"}');
  });

  it('buffers split chunks across push calls', () => {
    const parser = new SseParser();
    const first = parser.push('event: delta\nda');
    expect(first).toHaveLength(0);

    const second = parser.push('ta: {"text":"Squats "}\n\n');
    expect(second).toHaveLength(1);
    expect(second[0].event).toBe('delta');
    expect(second[0].data).toBe('{"text":"Squats "}');
  });

  it('ignores keep-alive comments', () => {
    const parser = new SseParser();
    const events = parser.push(': keep-alive\n\nevent: reset\ndata: {}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('reset');
  });

  it('flushes pending unclosed buffer', () => {
    const parser = new SseParser();
    parser.push('event: done\ndata: {"reply":"Done!"}');
    const events = parser.flush();

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('done');
    expect(events[0].data).toBe('{"reply":"Done!"}');
  });
});
