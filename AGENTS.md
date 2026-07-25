# Yonagi Noa motion authoring rules

## Screenshot-gated VRMA visual QA

VRMA schema validation, a successful build, and successful browser playback are
not sufficient evidence that a generated motion is visually correct.

Before publishing any new or changed motion:

- Capture every motion at 25%, 50%, and 75% of its duration from the normal
  viewer angle.
- Capture the highest-risk hand pose from both the normal and an oblique angle.
- Inspect hands, wrists, elbows, and shoulders for body/clothing penetration,
  left/right-hand overlap, floating planar palms, hyperextended joints, and a
  gesture that does not match the motion label.
- Capture the reset/neutral pose from the same camera as the comparison
  baseline. Every motion must visibly depart from that baseline in at least one
  audited frame through an intentional elbow bend, wrist displacement, or arm
  silhouette change. A set of differently labeled screenshots that still read
  as the same A-pose fails the audit.
- Do not fix hand intersections by simply returning all arms to the neutral
  pose. The retry must satisfy both gates at once: natural hands and a
  motion-specific silhouette that is distinguishable in a static overview.
- Treat any visibly awkward frame as a failure even when the VRMA validator and
  browser playback pass. Revise the source spec, regenerate the VRMA, and repeat
  the screenshot audit.
- Preserve compact before/after and timeline overview images under
  `artifacts/hand-audit-*` as the completion evidence. Raw per-frame captures
  may remain local and ignored.

Do not report a motion finished until this screenshot-based audit passes for
every in-scope motion.
