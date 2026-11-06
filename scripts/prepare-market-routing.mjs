import {rename} from 'node:fs/promises';

/** Vercel resolves static files before rewrites. Keep /market free for the
 * printing query routes; ordinary market visits use the identical static shell.
 * Run only after build.mjs has generated the server template from market.html.
 */
export async function prepareMarketRouting(outputDirectory=new URL('../public/',import.meta.url)){
 await rename(new URL('market.html',outputDirectory),new URL('market-shell.html',outputDirectory));
}
