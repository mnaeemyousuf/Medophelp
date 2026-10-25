import { env } from '../config/env';
import { connectDb, disconnectDb } from '../core/db';
import { seed } from './seed';

if (env.isProd) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
if (!env.SEED_DEMO_PASSWORD) {
  console.error('Set SEED_DEMO_PASSWORD in server/.env (development only) before seeding.');
  process.exit(1);
}

await connectDb(env.MONGODB_URI);
try {
  const result = await seed(env.SEED_DEMO_PASSWORD);
  console.log('Seed complete:', result);
} finally {
  await disconnectDb();
}
