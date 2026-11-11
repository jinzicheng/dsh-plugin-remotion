import {readFileSync} from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const TICK = String.fromCharCode(96);
lines.forEach((line, index) => {
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === TICK && line[i - 1] !== '\\') count += 1;
  }
  if (count > 0) console.log(`${index + 1}: [${count}] ${line.slice(0, 100)}`);
});
