// A mod gimmick script that tries to leave the sandbox (see Notes/mod-sandbox.md for how to run it).
// Every line it logs should read undefined, blocked, string or number.
const results = [];
const tryIt = (name, fn) => {
  try {
    const v = fn();
    results.push(`${name}: ${v === undefined ? 'undefined' : typeof v === 'object' || typeof v === 'function' ? `GOT ${Object.prototype.toString.call(v)}` : String(v)}`);
  } catch (e) {
    results.push(`${name}: blocked (${e && e.name})`);
  }
};
let done = false;
export default {
  frame(fighter) {
    if (done) return;
    done = true;
    tryIt('window', () => typeof window);
    tryIt('document', () => typeof document);
    tryIt('fetch', () => typeof fetch);
    tryIt('localStorage', () => typeof localStorage);
    tryIt('indexedDB', () => typeof indexedDB);
    tryIt('setTimeout', () => typeof setTimeout);
    tryIt('globalThis.location', () => globalThis.location);
    tryIt('fighter.constructor.constructor', () => fighter.constructor.constructor('return window')());
    tryIt('getter constructor', () => Object.getOwnPropertyDescriptor(fighter, 'x').get.constructor('return window')());
    tryIt('method constructor', () => fighter.slot.constructor('return document')());
    tryIt('async constructor', () => (async () => {}).constructor('return window')());
    tryIt('own Function', () => Function('return typeof document')());
    tryIt('indirect eval', () => (0, eval)('typeof document'));
    tryIt('lists constructor', () => fighter.lists.constructor.constructor('return window')());
    tryIt('array method constructor', () => fighter.lists.Percentage.push.constructor('return window')());
    tryIt('Math.random', () => Math.random());
    tryIt('Date.now', () => Date.now());
    tryIt('new Date', () => String(new Date()));
    tryIt('Array.prototype write', () => {
      Array.prototype.push = () => 0;
      return 'changed';
    });
    tryIt('facade write', () => {
      fighter.index = 99;
      return fighter.index;
    });
    tryIt('object into lists', () => {
      fighter.lists.Percentage.push({ toString: () => 'obj' });
      const v = fighter.lists.Percentage[fighter.lists.Percentage.length - 1];
      fighter.lists.Percentage.pop();
      return typeof v;
    });
    tryIt('percent from object', () => {
      const before = fighter.percent;
      fighter.percent = { valueOf: () => 5 };
      const t = typeof fighter.lists.Percentage[fighter.index - 1];
      fighter.percent = before;
      return t;
    });
    console.log(results.join(' | '));
  },
};
