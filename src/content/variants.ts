// Floor variants: cheap variety that shows up in exit omens, so route choice is informed.

export interface VariantDef {
  key: string;
  name: string;
  desc: string;
  /** Zones where the variant may appear. */
  zones: string[];
}

export const VARIANTS: Record<string, VariantDef> = {
  flooded: { key: 'flooded', name: 'Flooded', desc: 'The sea is already in: deeper pools and more swimming.', zones: ['deep', 'cloister', 'caves'] },
  overgrown: { key: 'overgrown', name: 'Overgrown', desc: 'Thick growth: good for hiding — and for burning.', zones: ['deep', 'cloister', 'caves', 'surface'] },
  luminous: { key: 'luminous', name: 'Luminous', desc: 'Glowing walls: more light, fewer shadows.', zones: ['deep', 'caves'] },
  restless: { key: 'restless', name: 'Restless', desc: 'Nothing here sleeps, and there is more of it.', zones: ['deep', 'cloister', 'caves'] },
  hushed: { key: 'hushed', name: 'Hushed', desc: 'Almost everything here is asleep.', zones: ['deep', 'cloister', 'caves'] },
  gloom: { key: 'gloom', name: 'Gloom', desc: 'Your lantern gutters: −2 light radius here.', zones: ['deep', 'cloister', 'caves'] },
};
