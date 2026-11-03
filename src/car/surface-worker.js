// The body surface sampler, run in a worker: tools/build.mjs bundles this file on its own and puts it in the page as text.
// Takes one [body, opts] at a time, with the lattice of the surface it is sampled on top of, and posts its lattice back.
// See prefetchSurfaces() in surface.js.
import {bodySurface, seedSurface} from './surface.js';

self.onmessage = ({data: {body, opts, base}}) => {
  if (base) seedSurface(...base);
  self.postMessage({body, opts, rec: bodySurface(body, opts).rec});
};
