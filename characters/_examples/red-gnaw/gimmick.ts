import type { Gimmick } from '@characters/api';

// Every hit adds a third of a Red stack to the target, and Red lasts 3 seconds after the last hit.
// At 3 full stacks the target takes a burst of damage, its Red clears, and it is painted red for 3 seconds.
// The target's gimmick slots 3 and 4 hold its Red, so it works on every character. The red1 to red9
// particles show it.
const THIRDS = 3;
const UNTIL = 4;
const LASTS = 90;
const BURST_AT = 9;
const BURST_DAMAGE = 18;
/** The red of the Red marks. */
const RED = '#e8242c';

export default {
  frame(fighter) {
    // Only the first Red Gnaw in a match draws the marks, so two of them do not draw them twice.
    if (fighter.all().find((f) => f.character === fighter.character)?.index !== fighter.index) return;
    for (const f of fighter.all()) {
      const thirds = f.slot(THIRDS);
      if (!thirds) continue;
      if (fighter.time >= f.slot(UNTIL)) f.setSlot(THIRDS, 0);
      else f.particle(`red${thirds}`, 0, f.height / 2 + 12);
    }
  },
  hit(fighter, target, hitbox) {
    if (target.action === 'shield') return;
    const now = fighter.time;
    let thirds = now < target.slot(UNTIL) ? target.slot(THIRDS) + 1 : 1;
    if (thirds >= BURST_AT) {
      target.percent += BURST_DAMAGE;
      target.particle('02_Expl');
      target.tint(RED, LASTS);
      hitbox.playSound('ShieldBreak');
      thirds = 0;
    }
    target.setSlot(THIRDS, thirds);
    target.setSlot(UNTIL, now + LASTS);
  },
} satisfies Gimmick;
