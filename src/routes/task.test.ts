import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { asc, desc } from 'drizzle-orm';
import { task } from '../db/schema.js';

var selectMock: any;
var insertMock: any;

vi.mock('../db/index.js', () => {
  selectMock = vi.fn();
  insertMock = vi.fn();
  return {
    default: {
      select: (...args: any[]) => selectMock(...args),
      insert: (...args: any[]) => insertMock(...args),
    },
  };
});

import taskRoute from './task';

describe('taskRoute', () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
  });

  it('GET /duplicants/:id/tasks returns tasks', async () => {
    const tasks = [
      {
        id: 't1',
        duplicantId: 'd1',
        description: 'Dig',
        status: 'pending',
        duration: 2,
        priority: 6,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const orderByMock = vi.fn().mockResolvedValue(tasks);
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: orderByMock,
        }),
      }),
    });

    const app = new Hono();
    app.route('/', taskRoute);

    const res = await app.request('/duplicants/d1/tasks');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(tasks);
    expect(orderByMock).toHaveBeenCalledWith(desc(task.priority), asc(task.createdAt));
  });

  it('POST /duplicants/:id/tasks creates a task', async () => {
    insertMock.mockReturnValue({
      values: (v: any) => ({
        returning: () => Promise.resolve([{ id: 't1', ...v }]),
      }),
    });

    const app = new Hono();
    app.route('/', taskRoute);

    const res = await app.request('/duplicants/d1/tasks', {
      method: 'POST',
      body: JSON.stringify({ description: 'Build ladder', duration: 3, priority: 7 }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 't1',
      duplicantId: 'd1',
      description: 'Build ladder',
      duration: 3,
      priority: 7,
      status: 'pending',
    });
  });
});

