// Runs before the sandbox library loads, because the library reads the page's globals once as it loads.
// Some browsers build Temporal with the built-ins of whichever frame reads it first, and lockdown refuses
// a Temporal from another frame. The game never uses Temporal, so a Temporal that lockdown would refuse is removed.
const page = globalThis as { Temporal?: unknown };
const t = page.Temporal;
if (t !== undefined && (typeof t !== 'object' || t === null || Object.getPrototypeOf(t) !== Object.prototype)) Reflect.deleteProperty(page, 'Temporal');

export {};
