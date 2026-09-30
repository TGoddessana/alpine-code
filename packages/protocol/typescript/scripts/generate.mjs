// Turns ../schema/protocol.schema.json (generated from the Python models) into src/generated.ts.
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const schemaUrl = new URL('../../schema/protocol.schema.json', import.meta.url);
const outUrl = new URL('../src/generated.ts', import.meta.url);

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
const version = Number(/protocol version (\d+)/.exec(schema.description)[1]);

const types = await compile(schema, schema.title, {
  bannerComment: '',
  unreachableDefinitions: true,
  additionalProperties: false,
  style: { printWidth: 120, singleQuote: true },
});

// The root schema only holds the definitions; drop its empty interface.
const body = types.replace(/\/\*\*\n \* alpine-code protocol[\s\S]*?\n}\n/, '');

// Method name -> params and result, so a request's types follow from its name.
const methods = Object.entries(schema['x-methods'])
  .map(([name, { params, result }]) => `  '${name}': { params: ${params}; result: ${result} };`)
  .join('\n');

const header = '// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.\n\n';
await writeFile(
  outUrl,
  `${header}export const PROTOCOL_VERSION = ${version};\n\n${body}\nexport interface Methods {\n${methods}\n}\n`,
);
