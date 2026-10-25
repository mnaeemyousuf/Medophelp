import mongoose from 'mongoose';
import { logger } from './logger';

// Every query issued inside connection.transaction() automatically joins the transaction,
// so services never have to thread a session through by hand.
mongoose.set('transactionAsyncLocalStorage', true);
// Operator injection ($ne, $gt in user input) is prevented upstream: every body/query/param passes a
// zod schema that only yields primitives, so raw request objects never reach a filter.
mongoose.set('strictQuery', true);

export async function connectDb(uri: string) {
  await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 10_000 });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

type TxStore = { session?: { inTransaction(): boolean } };
const txStorage = () => (mongoose as unknown as { transactionAsyncLocalStorage?: { getStore(): TxStore | undefined } }).transactionAsyncLocalStorage;

/** True when the caller is already inside withTransaction(). */
export const inTransaction = () => !!txStorage()?.getStore()?.session?.inTransaction();

/**
 * Run fn in a multi-document ACID transaction (retries transient errors). Re-entrant: when called
 * inside another transaction it joins it, so services can compose (e.g. an ER disposition that
 * admits the patient) and still commit or roll back as one unit.
 */
export function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (inTransaction()) return fn();
  return mongoose.connection.transaction(fn);
}
