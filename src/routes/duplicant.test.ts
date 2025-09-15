import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

var selectMock: any;
var insertMock: any;
var valuesSpy: (v: any) => any;

vi.mock('../db/index.js', () => {
  selectMock = vi.fn();
  insertMock = vi.fn();
  return {
    default: {
      select: (...args: any[]) => selectMock(...args),
      insert: (...args: any[]) => insertMock(...args),
    },
    DEFAULT_SCHEDULE_ID: 'default',
  };
});

import duplicantRoute from './duplicant';

describe('duplicantRoute', () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    valuesSpy = vi.fn();
  });

  it('GET / returns all duplicants', async () => {
    const duplicants = [
      { id: 'd1', name: 'Ada', scheduleId: 's1', createdAt: '2024-01-01T00:00:00.000Z' },
    ];
    selectMock.mockReturnValue({
      from: vi.fn().mockResolvedValue(duplicants),
    });

    const app = new Hono();
    app.route('/', duplicantRoute);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(duplicants);
  });

  it('POST / uses default schedule id when none provided', async () => {
    insertMock.mockReturnValue({
      values: (v: any) => {
        valuesSpy(v);
        return {
          returning: () => Promise.resolve([{ id: 'd1', ...v }]),
        };
      },
    });

    const app = new Hono();
    app.route('/', duplicantRoute);

    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'd1', name: 'Ada', scheduleId: 'default' });
    expect(valuesSpy).toHaveBeenCalledWith({ name: 'Ada', scheduleId: 'default' });
  });
});

