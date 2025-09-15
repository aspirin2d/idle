import { describe, it, expect, beforeEach, vi } from 'vitest';

const { selectMock, insertMock, valuesSpy } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  valuesSpy: vi.fn(),
}));

vi.mock('@electric-sql/pglite', () => ({ PGlite: vi.fn() }));
vi.mock('drizzle-orm/pglite', () => ({
  drizzle: () => ({ select: selectMock, insert: insertMock }),
}));
vi.mock('drizzle-orm', () => ({ eq: () => 'eq' }));
vi.mock('./schema.js', () => ({ schedule: { id: 'id' } }));

import { ensureDefaultSchedule, DEFAULT_SCHEDULE_ID, DEFAULT_SCHEDULE_ACTIVITIES } from './index';

describe('ensureDefaultSchedule', () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    valuesSpy.mockReset();
  });

  it('inserts default schedule when missing', async () => {
    selectMock.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
    valuesSpy.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    insertMock.mockReturnValue({ values: valuesSpy });

    await ensureDefaultSchedule();

    expect(insertMock).toHaveBeenCalledWith({ id: 'id' });
    expect(valuesSpy).toHaveBeenCalledWith({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
  });

  it('does nothing when schedule exists', async () => {
    selectMock.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: DEFAULT_SCHEDULE_ID }]),
      }),
    });

    await ensureDefaultSchedule();

    expect(insertMock).not.toHaveBeenCalled();
  });
});

