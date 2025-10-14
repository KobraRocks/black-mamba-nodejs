#!/usr/bin/env node
import { version, bump, setVersion } from '../libs/version/index.js';

function usage() {
  console.log('Usage: node bin/version.js [show|bump <major|minor|patch>|set <x.y.z>] [--json]');
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const cmd = args.find(a => !a.startsWith('--')) || 'show';

function out(obj) {
  if (flags.has('--json')) {
    console.log(JSON.stringify(obj));
  } else {
    if (typeof obj === 'string') console.log(obj);
    else if (obj && typeof obj.version === 'string') console.log(obj.version);
    else console.log(String(obj));
  }
}

switch (cmd) {
  case 'show':
    out({ version });
    break;
  case 'bump': {
    const kind = args.find(a => ['major', 'minor', 'patch'].includes(a)) || 'patch';
    const v = bump(kind);
    out({ version: v, action: 'bump', kind });
    break;
  }
  case 'set': {
    const vArg = args.find(a => /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(a));
    if (!vArg) usage();
    const v = setVersion(vArg);
    out({ version: v, action: 'set' });
    break;
  }
  default:
    usage();
}

