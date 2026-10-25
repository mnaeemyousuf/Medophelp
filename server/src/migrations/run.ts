import { env } from '../config/env';
import { connectDb, disconnectDb } from '../core/db';
import { MIGRATIONS, runMigrations } from './migrations';

await connectDb(env.MONGODB_URI);
try {
  const applied = await runMigrations();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : `Database is up to date (${MIGRATIONS.length} migrations known).`);
} finally {
  await disconnectDb();
}
