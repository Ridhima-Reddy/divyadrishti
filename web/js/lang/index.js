// Indian-language packs. English lives in the shared files (questions.js,
// i18n.js); every other language is exactly one pack file here, so a native
// reviewer checks one file and adding a language is one file + its locale.
import hi from './hi.js';
import ta from './ta.js';
import te from './te.js';
import mr from './mr.js';
import kn from './kn.js';

export const PACKS = [hi, ta, te, mr, kn];
export const PACK_BY_CODE = Object.fromEntries(PACKS.map((p) => [p.code, p]));
