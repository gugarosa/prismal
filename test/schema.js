// @ts-check
import { readFile } from "node:fs/promises";

export const manifestSchema = JSON.parse(
  await readFile(new URL("../schema/prismal.schema.json", import.meta.url), "utf8"),
);
export const choicesSchema = JSON.parse(
  await readFile(new URL("../schema/choices.schema.json", import.meta.url), "utf8"),
);

/** @param {unknown} left @param {unknown} right */
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** @param {string} reference @param {Record<string, any>} root */
function dereference(reference, root) {
  return reference
    .slice(2)
    .split("/")
    .reduce((value, part) => value[part.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

/** @param {unknown} value @param {string} type */
function hasType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/** Small evaluator for the structural keywords used by these schemas. @param {any} schema @param {unknown} value @param {any} root */
export function valid(schema, value, root = schema) {
  if (typeof schema === "boolean") return schema;
  if (schema.$ref && !valid(dereference(schema.$ref, root), value, root)) return false;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => hasType(value, type))) return false;
  }
  if ("const" in schema && !same(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((item) => same(value, item))) return false;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (
      schema.format === "date-time" &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
        Number.isNaN(Date.parse(value)))
    ) {
      return false;
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = /** @type {Record<string, unknown>} */ (value);
    if (schema.required?.some((key) => !Object.hasOwn(object, key))) return false;
    if (
      schema.properties &&
      Object.entries(schema.properties).some(
        ([key, child]) => Object.hasOwn(object, key) && !valid(child, object[key], root),
      )
    ) {
      return false;
    }
    if (schema.propertyNames && Object.keys(object).some((key) => !valid(schema.propertyNames, key, root))) {
      return false;
    }
    if (schema.additionalProperties !== undefined) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const [key, child] of Object.entries(object)) {
        if (known.has(key)) continue;
        if (schema.additionalProperties === false || !valid(schema.additionalProperties, child, root)) {
          return false;
        }
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (
      schema.prefixItems?.some((child, index) => index < value.length && !valid(child, value[index], root))
    ) {
      return false;
    }
    const offset = schema.prefixItems?.length ?? 0;
    if (schema.items === false && value.length > offset) return false;
    if (schema.items && value.slice(offset).some((child) => !valid(schema.items, child, root))) {
      return false;
    }
    if (schema.contains) {
      const count = value.filter((child) => valid(schema.contains, child, root)).length;
      if (count < (schema.minContains ?? 1) || count > (schema.maxContains ?? Infinity)) return false;
    }
  }
  if (schema.not && valid(schema.not, value, root)) return false;
  if (schema.allOf?.some((child) => !valid(child, value, root))) return false;
  if (schema.anyOf && !schema.anyOf.some((child) => valid(child, value, root))) return false;
  if (schema.oneOf && schema.oneOf.filter((child) => valid(child, value, root)).length !== 1) return false;
  if (schema.if) {
    const branch = valid(schema.if, value, root) ? schema.then : schema.else;
    if (branch && !valid(branch, value, root)) return false;
  }
  return true;
}
