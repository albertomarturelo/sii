export * from './format.js';
// Public for a consumer's in-place repair of stored text (GH-279). `repairedText` stays internal:
// it is the facades' wire-value helper (`unknown` in), not a text primitive.
export { repairMojibake } from './text.js';
