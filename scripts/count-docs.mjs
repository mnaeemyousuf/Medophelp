// Prints the total document count of each named database (restore drills): node scripts/count-docs.mjs <uri> db1 db2 …
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mongoose = require('mongoose');
const [uri, ...dbs] = process.argv.slice(2);
const client = (await mongoose.connect(uri)).connection.getClient();
for (const name of dbs) {
  const db = client.db(name);
  let total = 0;
  for (const c of await db.listCollections().toArray()) total += await db.collection(c.name).countDocuments();
  console.log(`${name}: ${total} documents`);
}
await client.close();
