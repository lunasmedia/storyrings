/**
 * Conformance: every case in /spec/cases must give its `expect` result with this SDK's code.
 * Run `pnpm --filter @stories/core spec:update` to (re)write the expected results from the
 * current code, only when a behaviour change is intended, and review the diff.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { constants, suites } from './conformance/adapter.js';

const SPEC = join(import.meta.dirname, '../../../spec');
const CASES = join(SPEC, 'cases');
const UPDATE = process.env.UPDATE_SPEC === '1';

interface Case {
  name: string;
  input: unknown;
  expect?: unknown;
}
interface SuiteFile {
  suite: string;
  description: string;
  cases: Case[];
}

const write = (path: string, data: unknown) =>
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

describe('conformance constants', () => {
  it('match spec/constants.json', () => {
    const path = join(SPEC, 'constants.json');
    if (UPDATE) write(path, constants());
    expect(constants()).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  });
});

for (const file of readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const path = join(CASES, file);
  const data = JSON.parse(readFileSync(path, 'utf8')) as SuiteFile;
  const run = suites[data.suite];

  describe(`conformance: ${data.suite}`, () => {
    if (!run) throw new Error(`${file}: no adapter for suite "${data.suite}"`);
    if (UPDATE) {
      it('updates expected results', async () => {
        for (const c of data.cases) c.expect = JSON.parse(JSON.stringify(await run(c.input)));
        write(path, data);
      });
      return;
    }
    for (const c of data.cases) {
      it(c.name, async () => {
        expect(
          c.expect,
          `${file}: "${c.name}" has no expected result; run spec:update`,
        ).toBeDefined();
        expect(JSON.parse(JSON.stringify(await run(c.input)))).toEqual(c.expect);
      });
    }
  });
}
