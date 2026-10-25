// Exports the real role → permission → menu → report mapping used by the app, so the manuals and the
// role matrix are generated from the source of truth. Run: npx tsx tools/manuals/export-roles.ts
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, REPORTS } from '@hms/shared';
import { NAV } from '../../client/src/app/nav';

const out = Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, perms]) => {
  const has = (...p: string[]) => p.some((x) => perms.includes(x as never));
  const menus = NAV.map((s) => ({ section: s.title, items: s.items.filter((i) => i.anyOf.length === 0 || has(...i.anyOf)).map((i) => ({ label: i.label, to: i.to })) })).filter((s) => s.items.length);
  const reports = REPORTS.filter((r) => has(...r.anyOf)).map((r) => ({ key: r.key, title: r.title, category: r.category }));
  return { role, permissions: perms.map((p) => ({ key: p, ...PERMISSIONS[p] })), menus, reports };
});
const target = path.resolve('tools/manuals/build/roles.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ allPermissions: PERMISSIONS, roles: out }, null, 2));
console.log(`wrote ${out.length} roles to ${target}`);
