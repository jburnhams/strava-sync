import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSyncStreams, handleGetActivityDetail } from '../src/sync';
import { deleteActivity, deleteAllActivities, updateUserSyncConfig } from '../src/db';

const mockDB = {
  prepare: vi.fn(),
};

describe('Advanced Sync Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleSyncStreams should fetch streams for activity', async () => {
    const mockUser = { strava_id: 1, access_token: 'token' };
    const mockActivities = [{ id: 101 }];

    // Mock DB calls
    mockDB.prepare.mockImplementation((query) => {
      if (query.includes('SELECT * FROM users')) {
        return { bind: () => ({ first: async () => mockUser }) };
      }
      if (query.includes('SELECT a.id FROM activities')) {
         return { bind: () => ({ all: async () => ({ results: mockActivities }) }) };
      }
      if (query.includes('INSERT INTO streams')) {
         return { bind: () => ({ run: async () => {} }) };
      }
       if (query.includes('UPDATE streams')) {
         return { bind: () => ({ run: async () => {} }) };
      }
      if (query.includes('SELECT id FROM streams')) {
          return { bind: () => ({ first: async () => null }) };
      }
      return { bind: () => ({ run: async () => {}, first: async () => null, all: async () => ({ results: [] }) }) };
    });

    // Mock Fetch
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ type: 'latlng', data: [[1,1]] }]
    });

    const req = new Request('http://localhost/api/users/1/streams?limit=1', { method: 'POST' });
    const res = await handleSyncStreams(req, { DB: mockDB } as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.synced).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/streams'),
        expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
    );
  });
});

describe('Activity Management', () => {
    it('should delete activity and streams', async () => {
         mockDB.prepare.mockReturnValue({ bind: () => ({ run: async () => {} }) });
         await deleteActivity(mockDB as any, 123);
         expect(mockDB.prepare).toHaveBeenCalledWith("DELETE FROM activities WHERE id = ?");
         expect(mockDB.prepare).toHaveBeenCalledWith("DELETE FROM streams WHERE activity_id = ?");
    });

     it('should delete all activities', async () => {
         mockDB.prepare.mockReturnValue({ bind: () => ({ run: async () => {} }) });
         await deleteAllActivities(mockDB as any, 999);
         expect(mockDB.prepare).toHaveBeenCalledWith("DELETE FROM activities WHERE strava_id = ?");
         expect(mockDB.prepare).toHaveBeenCalledWith("DELETE FROM streams WHERE strava_id = ?");
    });
});
