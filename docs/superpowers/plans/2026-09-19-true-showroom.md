# True 3D homepage showroom — preview implementation

Approved scope: actual 3D room and camera translation; three supplied original artworks; all hero copy and both CTAs on a physical information wall; existing SiteChrome navigation unchanged; click-to-walk and drag-to-look; no production release.

Architecture: Three.js 0.180.0 already installed in the project. A dynamically imported WebGL engine adds procedural gallery geometry, print textures, static shadows, a navigable camera and raycast CTAs. A client wrapper progressively enhances the existing server-rendered hero. Its original H1 and functional links remain the accessible/non-WebGL fallback. The current --font-body and --font-display variables are reused.

Artworks: the three supplied JPEG files were imported byte-for-byte with SHA-256 checks. They are committed under public/media/showroom and have no runtime dependency on temporary upload URLs.

Interaction: click a print or its labelled button to walk closer; drag to look; + / - step forward/back; Escape or Back returns. The camera keeps a fixed focal length during travel, moves at 1.65 m eye height, and follows a clear route around the bench. Default page scrolling is not captured. Narrow screens begin at the information wall; the same three artwork buttons remain available. Reduced-motion transitions are immediate. The renderer sleeps when idle/offscreen and releases resources on unmount. Unsupported WebGL restores the original hero.

Verified locally: five navigation tests, 19 Chromium/SwiftShader browser checks covering the supplied dimensions, all three physical camera destinations, step closer, return, direct artwork raycast, page scrolling, mobile taps, reduced motion, cleanup, and no-WebGL fallback. These do not claim real-device Safari/performance certification. Server build and deployed-preview checks are recorded separately in the PR.

Production: main, DNS, deployment settings, environment variables, databases, authentication, orders, payment and analytics code are not changed. This branch is a review preview only.
