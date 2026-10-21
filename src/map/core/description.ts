// A MAP description: the JSON-LD a message carries beside its readable content.
import { coreSchema, createValidator, DESCRIPTION_MAX_BYTES, schemaErrors } from './artifacts.ts';
import { InvalidDocument, parse } from './json.ts';

export interface Description {
  '@context': string;
  '@type': 'MailAction';
  '@id': string;
  profile: string;
  type: { id: string; version: string; contractDigest: string };
  issuedAt: string;
  expiresAt: string;
  inLanguage: string;
  service: { id: string; tenant?: string };
  recipient: string;
  subject: { id: string; title: string };
  terms: { id: string; version: string };
  details: Record<string, unknown>;
  operations: { id: string; capability?: { url: string } }[];
  human: { url: string };
}

const validate = createValidator().compile<Description>(coreSchema);

// Whitespace, controls, bidirectional and invisible formatting characters.
const UNSAFE = /[\p{White_Space}\p{Cc}\p{Cf}]/u;

// A well-formed BCP 47 language tag: RFC 5646's langtag, privateuse and grandfathered forms.
const LANGUAGE_TAG = new RegExp(
  '^(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?' +
    '(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?' +
    '|x(?:-[a-z0-9]{1,8})+' +
    '|en-gb-oed|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)' +
    '|sgn-(?:be-fr|be-nl|ch-de)|art-lojban|cel-gaulish|no-(?:bok|nyn)|zh-(?:guoyu|hakka|min|min-nan|xiang))$',
  'i',
);

/**
 * Why the value is not a MAP 0.3 description, or no reasons. Beyond the core schema:
 * expiry follows issuance, inLanguage is a well-formed BCP 47 tag, operation identifiers are
 * unique, and no security-sensitive identifier contains whitespace, a control or a
 * formatting character.
 */
export function descriptionErrors(value: unknown): string[] {
  if (!validate(value)) return schemaErrors(validate.errors);
  const errors: string[] = [];
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt))
    errors.push('/expiresAt: must be later than issuedAt');
  if (!LANGUAGE_TAG.test(value.inLanguage))
    errors.push('/inLanguage: must be a well-formed BCP 47 language tag');
  const ids = value.operations.map((operation) => operation.id);
  if (new Set(ids).size !== ids.length) errors.push('/operations: identifiers must be unique');
  const identifiers: [string, string | undefined][] = [
    ['/@id', value['@id']],
    ['/type/id', value.type.id],
    ['/service/id', value.service.id],
    ['/service/tenant', value.service.tenant],
    ['/recipient', value.recipient],
    ['/subject/id', value.subject.id],
    ['/terms/id', value.terms.id],
    ['/human/url', value.human.url],
    ...value.operations.map(
      (operation, index): [string, string | undefined] => [
        `/operations/${index}/capability/url`,
        operation.capability?.url,
      ],
    ),
  ];
  for (const [pointer, identifier] of identifiers)
    if (identifier !== undefined && UNSAFE.test(identifier))
      errors.push(`${pointer}: must not contain whitespace, controls or formatting characters`);
  return errors;
}

/** The description in the bytes or text, or InvalidDocument with every reason it is not one. */
export function parseDescription(input: string | Uint8Array): Description {
  const value = parse(input, DESCRIPTION_MAX_BYTES);
  const errors = descriptionErrors(value);
  if (errors.length) throw new InvalidDocument('The value is not a MAP 0.3 description.', errors);
  return value as Description;
}
