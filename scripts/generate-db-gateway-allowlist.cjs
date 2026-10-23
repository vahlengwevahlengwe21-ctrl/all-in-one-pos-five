const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function collectSqlHashes(directory, hashes = new Set()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSqlHashes(filePath, hashes);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isStringLiteralLike(node)) {
        const sql = normalizeSql(node.text);
        if (/^(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
          hashes.add(crypto.createHash('sha256').update(sql).digest('hex'));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hashes;
}

const roots = ['src', 'vercel-deploy/src'].filter(root => fs.existsSync(root));
const hashes = new Set(roots.flatMap(root => [...collectSqlHashes(root)]));
if (!hashes.size) throw new Error('No POS SQL statements were found for the gateway allowlist.');

const outputPath = path.resolve('scripts/db-gateway-pos-allowlist.json');
fs.writeFileSync(outputPath, `${JSON.stringify([...hashes].sort(), null, 2)}\n`, { flag: 'w' });
console.log(`Wrote ${hashes.size} POS SQL hashes to ${outputPath}`);
