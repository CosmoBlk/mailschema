// MAP 0.3's identifiers, limits and schema validation.
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export { coreSchema, contractSchema, implementationSchema } from './bundled.ts';

export const PROFILE = 'https://mailschema.org/profiles/map/0.3';
export const CONTEXT = 'https://mailschema.org/contexts/map-0.3.jsonld';
/** The Content-Type of the MIME part that carries a description. */
export const DESCRIPTION_MEDIA_TYPE = `application/ld+json; profile="${PROFILE}"`;
export const DESCRIPTION_MAX_BYTES = 65536;
export const CONTRACT_MAX_BYTES = 262144;
/** The namespace of the initial effect vocabulary. */
export const EFFECTS = 'https://mailschema.org/effects/';
/** The formats MAP schemas may assert. Every implementation checks exactly these. */
export const FORMATS = ['date', 'date-time', 'email', 'uri'] as const;

/**
 * JSON Schema 2020-12 as MAP reads it: the listed formats asserted, and references resolved
 * only within the schema, never over the network. MAP's own rules decide which keywords and
 * formats a contract may use; the validator adds no checks of its own beyond the vocabulary.
 * @internal
 */
export function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv, [...FORMATS]);
  // Ajv also reads OpenAPI's `nullable` and the earlier `dependencies` and `definitions`.
  for (const keyword of ['nullable', 'dependencies', 'definitions']) ajv.removeKeyword(keyword);
  return ajv;
}

/**
 * Each validation error as its JSON Pointer and message, reduced to the ones that say what to
 * fix: an enum or const error names the values it allows, an unexpected member is named, an
 * if/then wrapper is left to the error inside it, and a oneOf whose branches are told apart by
 * a const reports only the branch the value chose. @internal
 */
export const schemaErrors = (errors: ErrorObject[] | null | undefined, prefix = '') =>
  actionable(errors ?? []).map((error) => `${prefix + error.instancePath || '/'}: ${schemaMessage(error)}`);

function schemaMessage(error: ErrorObject): string | undefined {
  if (error.keyword === 'enum') return `must be one of ${listed((error.params as { allowedValues: unknown[] }).allowedValues)}`;
  if (error.keyword === 'const')
    return `must be ${JSON.stringify((error.params as { allowedValue: unknown }).allowedValue)}`;
  if (error.keyword === 'additionalProperties')
    return `must not have the member ${JSON.stringify((error.params as { additionalProperty: string }).additionalProperty)}`;
  return error.message;
}

const listed = (values: unknown[]) => values.map((value) => JSON.stringify(value)).join(', ');

function actionable(errors: ErrorObject[]): ErrorObject[] {
  let kept = errors.filter((error) => error.keyword !== 'if');
  for (const oneOf of kept.filter((error) => error.keyword === 'oneOf' && !error.params.passingSchemas)) {
    const branchOf = (error: ErrorObject) =>
      error.schemaPath.startsWith(`${oneOf.schemaPath}/`)
        ? Number(error.schemaPath.slice(oneOf.schemaPath.length + 1).split('/')[0])
        : undefined;
    const branches = new Map<number, ErrorObject[]>();
    for (const error of kept) {
      const branch = branchOf(error);
      if (branch !== undefined) branches.set(branch, [...(branches.get(branch) ?? []), error]);
    }
    // The discriminator: a const one level below the oneOf's value that a branch refused.
    const discriminator = (branch: ErrorObject[]) =>
      branch.find(
        (error) =>
          error.keyword === 'const' &&
          error.instancePath.startsWith(`${oneOf.instancePath}/`) &&
          !error.instancePath.slice(oneOf.instancePath.length + 1).includes('/'),
      );
    const refused = [...branches.values()].map(discriminator);
    const chosen = [...branches.keys()].filter((_, index) => !refused[index]);
    const sharedPointer = refused.find(Boolean)?.instancePath;
    if (chosen.length === 1 && refused.filter(Boolean).length === branches.size - 1) {
      kept = kept.filter((error) => error !== oneOf && (branchOf(error) ?? chosen[0]) === chosen[0]);
    } else if (chosen.length === 0 && sharedPointer && refused.every((error) => error?.instancePath === sharedPointer)) {
      const allowed = refused.map((error) => (error!.params as { allowedValue: unknown }).allowedValue);
      const combined = { ...refused[0]!, keyword: 'enum', params: { allowedValues: allowed } } as ErrorObject;
      kept = [...kept.filter((error) => error !== oneOf && branchOf(error) === undefined), combined];
    }
  }
  return kept;
}
