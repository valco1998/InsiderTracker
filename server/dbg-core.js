import * as M from 'api/dist/core/index.js';

console.log('TOP keys:', Object.keys(M));
console.log('TOP types:', Object.fromEntries(Object.entries(M).map(([k,v]) => [k, typeof v])));

const D = M.default;
console.log('DEFAULT type:', typeof D);
console.log('DEFAULT keys:', D && typeof D === 'object' ? Object.keys(D) : null);
console.log('DEFAULT types:', D && typeof D === 'object'
  ? Object.fromEntries(Object.entries(D).map(([k,v]) => [k, typeof v]))
  : null);

