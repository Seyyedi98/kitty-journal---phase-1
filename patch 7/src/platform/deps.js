// The one place the pure services get their real device implementations.
// Tests build the same shape from in-memory fakes (see tests/helpers.mjs).
// (Phase 2B adds `JSZip` here for ZIP backups.)
import { fs } from './fs';
import { manipulate } from './manipulate';

export const deps = { fs, manipulate };
