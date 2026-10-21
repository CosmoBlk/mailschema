#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  Contract,
  CONTRACT_MAX_BYTES,
  DESCRIPTION_MAX_BYTES,
  digest,
  extractMessage,
  InvalidDocument,
  parseDescription,
  parseImplementation,
} from '../dist/index.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const COMMANDS = {
  contract: {
    usage: 'mailschema contract <contract.json>',
    about: `Checks a type contract and prints "Valid type contract <id> <version>" and the
contract's digest. type.contractDigest in a description names this digest.`,
  },
  description: {
    usage: 'mailschema description <description.json> [--contract <contract.json>]',
    about: `Checks a description against MAP 0.3 Core and, with --contract, that it uses that
contract as it allows: its details and operations. Prints "Valid MAP 0.3 description
<@id>" and the description's digest, which is not the contract digest it names. It
checks the document only: whether the service, recipient and terms match a request
recorded when the person started it, and whether the description is still in its
issuedAt to expiresAt window, are for the implementation that acts on it.`,
  },
  implementation: {
    usage: 'mailschema implementation <record.json>',
    about: 'Checks a Registry implementation record and names the service it describes.',
  },
  message: {
    usage: 'mailschema message <message.eml>',
    about: `Finds a received email's one MAP part, writes its description to standard output
exactly as the part carries it, and prints the description's digest on standard error.`,
  },
};

const help = `Mail Action Protocol 0.3 checks, mailschema ${version}

${Object.values(COMMANDS)
  .map((command) => `  ${command.usage}`)
  .join('\n')}

Options: --json prints the result as JSON, --help after a command explains it, and
--version prints the package version. A digest is the SHA-256 of the document's RFC 8785
canonical JSON. Nothing is uploaded or changed. An invalid document prints every reason
it is not valid, one per line, and exits 1.`;

const commandHelp = (name) => `${COMMANDS[name].usage}\n\n${COMMANDS[name].about}\n\nAdd --json for a JSON result.`;

// A whole email, attachments included, is far larger than any MAP document.
const MESSAGE_MAX_BYTES = 26214400;

async function read(path, maxBytes, kind) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`Expected ${kind} of at most ${maxBytes} bytes.`);
  return new Uint8Array(await readFile(path));
}

function report(errors) {
  if (!errors.length) return;
  throw new InvalidDocument('Not valid.', errors);
}

let json = false;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      contract: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  json = Boolean(values.json);
  const [command, path, ...extra] = positionals;
  if (values.version) console.log(version);
  else if (values.help && Object.hasOwn(COMMANDS, command ?? '')) console.log(commandHelp(command));
  else if (values.help || !command) console.log(help);
  else if (!Object.hasOwn(COMMANDS, command)) throw new Error(`Unknown command ${command}.\n\n${help}`);
  else if (!path || extra.length || (values.contract && command !== 'description'))
    throw new Error(commandHelp(command));
  else if (command === 'contract') {
    const contract = Contract.parse(await read(path, CONTRACT_MAX_BYTES, 'a contract file'));
    if (json) print({ valid: true, id: contract.id, version: contract.version, digest: contract.digest });
    else console.log(`Valid type contract ${contract.id} ${contract.version}\n${contract.digest}`);
  } else if (command === 'description') {
    const description = parseDescription(await read(path, DESCRIPTION_MAX_BYTES, 'a description file'));
    if (values.contract)
      report(Contract.parse(await read(values.contract, CONTRACT_MAX_BYTES, 'a contract file')).descriptionErrors(description));
    if (json) print({ valid: true, id: description['@id'], digest: digest(description) });
    else console.log(`Valid MAP 0.3 description ${description['@id']}\n${digest(description)}`);
  } else if (command === 'message') {
    const result = extractMessage(await read(path, MESSAGE_MAX_BYTES, 'an email file'));
    if (result.status === 'none') throw new Error('The message has no MAP 0.3 part.');
    if (result.status === 'invalid') throw new Error(`The message's MAP part cannot be used: ${result.reason}.`);
    process.stdout.write(result.bytes);
    console.error(`Valid MAP 0.3 description ${result.description['@id']}\n${digest(result.description)}`);
  } else {
    const record = parseImplementation(await read(path, CONTRACT_MAX_BYTES, 'a record file'));
    if (json) print({ valid: true, service: record.service });
    else console.log(`Valid implementation record for ${record.service}`);
  }
} catch (error) {
  const errors = error instanceof InvalidDocument ? error.errors : [error.message];
  if (json) print({ valid: false, errors });
  else console.error(errors.join('\n'));
  process.exitCode = 1;
}

function print(result) {
  console.log(JSON.stringify(result));
}
