/** npm run check:user-texts: prints `file:line: problem: text` for each finding, exit code 1 if any. */
import { join } from 'path';
import { scanProject } from './user-texts';

const findings = scanProject(join(__dirname, '..', '..', '..'));
for (const f of findings)
  console.log(`${f.file}:${f.line}: ${f.problem}: ${JSON.stringify(f.text)}`);
console.log(
  findings.length
    ? `check:user-texts: ${findings.length} finding(s)`
    : 'check:user-texts: no findings',
);
process.exitCode = findings.length ? 1 : 0;
