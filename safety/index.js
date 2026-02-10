import antiScam from './antiScam.js';
import screenshotGuard from './screenshotGuard.js';
import aiEthics from './aiEthics.js';
import verifyIdentity from './verifyIdentity.js';

// Central export so routes can compose safety middleware chains
export const safetyMiddleware = {
  antiScam,
  screenshotGuard,
  aiEthics,
  verifyIdentity,
};

export default safetyMiddleware;
