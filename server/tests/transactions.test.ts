import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Schema } from 'mongoose';
import { connectDb, disconnectDb, inTransaction, withTransaction } from '../src/core/db';

const Probe = mongoose.models.TxProbe ?? mongoose.model('TxProbe', new Schema({ n: Number }));

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await Probe.deleteMany({});
});
afterAll(async () => {
  await Probe.deleteMany({});
  await disconnectDb();
});

describe('withTransaction', () => {
  it('detects an active transaction', async () => {
    expect(inTransaction()).toBe(false);
    await withTransaction(async () => {
      expect(inTransaction()).toBe(true);
    });
  });

  it('nested calls join the outer transaction: an outer failure rolls back inner writes', async () => {
    await expect(
      withTransaction(async () => {
        await Probe.create([{ n: 1 }]);
        await withTransaction(async () => {
          await Probe.create([{ n: 2 }]);
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await Probe.countDocuments({})).toBe(0);
  });

  it('commits everything when the outer transaction succeeds', async () => {
    await withTransaction(async () => {
      await Probe.create([{ n: 1 }]);
      await withTransaction(async () => {
        await Probe.create([{ n: 2 }]);
      });
    });
    expect(await Probe.countDocuments({})).toBe(2);
  });
});
