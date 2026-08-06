/**
 * Deterministic full-page composition contracts.
 *
 * These are not story templates: they only constrain staging so an image model
 * cannot reinterpret a narrative beat as a comic strip, portrait, or lineup.
 */
type CompositionInput = {
  comicBeat?: string;
  shotType?: string;
  action?: string;
  settingElements?: string[];
};

const BASE =
  "COMPOSITION BLUEPRINT: one uninterrupted portrait page with no internal borders. Use one primary action triangle, clear foreground overlap, an active middle-ground focal subject, and a simple background reaching every edge. Keep all heads and limbs inside the safe area. Reserve no panels, gutters, bubbles, captions, title boxes or decorative frames.";

const BEAT_BLUEPRINTS: Record<string, string> = {
  establishing:
    "Wide three-depth establishing scene: a large foreground prop at one lower corner, hero off-center on a rule-of-thirds point, destination visible in the upper opposite third.",
  action:
    "Dynamic diagonal action scene: hero moves across the page on one readable diagonal; interacting prop anchors the opposite lower corner; motion is shown by pose, never by comic speed lines.",
  obstacle:
    "Clear visual obstacle scene: obstacle spans the middle ground, hero approaches from one lower third, safe destination remains visible beyond it; preserve one continuous environment.",
  help:
    "Cooperative triangular composition: characters occupy separate thirds while handling the same large scene prop; bodies and silhouettes never overlap or merge.",
  emotion:
    "Intimate environmental scene: readable mid-shot with the full gesture visible, meaningful prop in foreground, setting still fills the background; never crop into a floating face portrait.",
  resolution:
    "Open celebratory full-page scene: hero at the lower-middle third completing the action, resolved destination behind, foreground props create depth; no posed lineup.",
};

const SHOT_BLUEPRINTS: Record<string, string> = {
  wide: "Camera is wide at child eye level; hero uses about 25–35% of page height.",
  full_body:
    "Show the complete body and action with breathing room around hands and feet; hero uses no more than 45% of page height.",
  mid_shot:
    "Show from at least mid-thigh upward plus both complete arms and the interacted object; retain substantial foreground and background.",
  close_safe:
    "Use a safe medium-close view, never an isolated head: complete head, shoulders, arms and the story prop remain visible inside the environment.",
};

export function buildCompositionBlueprint(input: CompositionInput): string {
  const beat = (input.comicBeat || "").toLowerCase();
  const shot = (input.shotType || "").toLowerCase();
  const setting = (input.settingElements || []).filter(Boolean).slice(0, 4);
  return [
    BASE,
    BEAT_BLUEPRINTS[beat] || BEAT_BLUEPRINTS.action,
    SHOT_BLUEPRINTS[shot] || SHOT_BLUEPRINTS.wide,
    input.action ? `Body-action anchor: ${input.action}.` : "",
    setting.length
      ? `Distribute these scene anchors across foreground, middle ground and background: ${setting.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
