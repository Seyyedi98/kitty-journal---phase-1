// The one place the pure services get their real device implementations.
// Tests build the same shape from in-memory fakes (see tests/helpers.mjs).
import JSZip from 'jszip';
import { fs } from './fs';
import { manipulate } from './manipulate';

export const deps = { fs, manipulate, JSZip };
