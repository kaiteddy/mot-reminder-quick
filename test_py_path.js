import { spawnSync } from 'child_process';
const res = spawnSync('/usr/bin/python3', ['--version'], { encoding: 'utf-8', shell: true });
console.log('STDOUT:', res.stdout);
console.log('STDERR:', res.stderr);
console.log('STATUS:', res.status);
