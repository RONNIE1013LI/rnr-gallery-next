# Showroom product-model reuse — Preview only

User direction: reuse the existing website models instead of simplified geometry; aluminium roll-up cassette, genuine wrapped canvas, fabric banner with more inset eyelets and fine fixing lines. Keep the approved click-to-walk interaction. Verify locally before one consolidated Preview push. Production is not approved.

## Implementation

- Import createRollUpBannerModel, createCanvasModel/getCanvasProfile, and createFabricBannerModel from the existing catalogue components. Preserve detailed hardware and rear construction. Uniform display scaling preserves model proportions; these are exhibition sizes rather than a life-size measurement promise.
- Roll-up floor contact derives from the existing swivel-foot bounds. Focus framing reserves clearance for the lower control bar and exposes the cassette side.
- Banner eyelet centres are 60 mm from each edge at the displayed size. Holes, rings and 1.4 mm diameter cords share coordinates; cord ends connect to small wall pins. Optional finishing arguments preserve all existing callers' 25 mm inset and cord defaults.
- The room retains the preceding local material/light refinements, including soft contact occlusion and restrained stone reflection. Preserve each existing material's shader cache key when attaching occlusion, including the canvas face, return and timber shaders.
- Original uploaded banner, canvas and roll-up JPEG files remain unchanged. Header, typography variables, commerce, authentication, analytics, database, deployment configuration and main are untouched.

## Evidence and limits

- 35 Node geometry/navigation tests passed against the final local source.
- 19 desktop Chromium/SwiftShader checks, four simulated mobile checks and one native scroll check passed. Separate browser processes and rendered-frame waits avoid treating a delayed software-rendered frame as a failed click.
- Locally inspected overview, banner, canvas and roll-up screenshots; final roll-up framing includes cassette and feet above the controls. These checks are not real-device Safari or frame-rate certification.
- Git blob hashes of the six changed runtime files match the locally tested files before the branch ref is moved.
- Website mode loads the existing /canvas-3d/material-reference.jpg for the canvas rear timber/label. The offline local build uses a neutral rear until a reference is available and hides the label rather than inventing a QR texture. The actual photographic rear texture was not visually verified offline.
- Full Next.js integration build is verified by the ensuing Vercel Preview build, separately from the local model/browser tests. No claim of deployed-browser verification is made here.

One feature-branch ref update only. Do not merge or promote without review.
