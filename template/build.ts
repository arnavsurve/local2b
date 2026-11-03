import { Template, defaultBuildLogger } from 'e2b';
import { resolveE2bKey } from '../src/creds';
import { template } from './template';

process.env.E2B_API_KEY = await resolveE2bKey();

const info = await Template.build(template, 'l2b-dev', {
  cpuCount: 8,
  memoryMB: 16384,
  requestTimeoutMs: 30 * 60 * 1000,
  onBuildLogs: defaultBuildLogger(),
});
console.log(info);
