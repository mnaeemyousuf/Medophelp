// Initiates replica set rs0 on the local dev mongod if it is not initiated yet.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/package.json'));
const { MongoClient } = require('mongoose').mongo;

const client = new MongoClient('mongodb://127.0.0.1:27018/?directConnection=true');
await client.connect();
const admin = client.db('admin');
try {
  await admin.command({ replSetGetStatus: 1 });
  console.log('Replica set rs0 already initiated.');
} catch (err) {
  if (err.codeName !== 'NotYetInitialized') throw err;
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27018' }] } });
  for (let i = 0; i < 30; i++) {
    const s = await admin.command({ replSetGetStatus: 1 }).catch(() => null);
    if (s?.members?.[0]?.stateStr === 'PRIMARY') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('Replica set rs0 initiated.');
}
await client.close();
