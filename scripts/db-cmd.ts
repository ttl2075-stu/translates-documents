import '../src/config.js';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2).join(' ');

try {
  execSync(`npx prisma ${args}`, {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err: any) {
  process.exit(err.status || 1);
}
