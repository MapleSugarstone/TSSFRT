import type { Fighter, Gimmick, Hitbox, MoveAttribute } from '@characters/api';

// Gnaw From Scratch: every move is this character's own data on the Moves tab, and this script moves the
// hitboxes the way Gnaw's move scripts do. He follows Gnaw's built-in rules (Overview tab), which set
// gimmick slot 1 to 1 when he lands after a jump. DownAirPunch steers by that amount and halves it.
//
// How to read it: `tick` runs every frame for each hitbox, and the switch at the bottom picks the move by
// name. `life(h)` is the hitbox's frame, counted from 1, so `life(h) <= 9` means its first 9 frames. Some
// moves run in phases instead: `h.phase(1, 7)` is true for the first 7 frames, `h.phase(2, 3)` for the 3
// after those, and so on. As in the original scripts, a phase starts on the last frame of the one before it.

const STEER = 1;

const life = (h: Hitbox) => h.frame + 1;

/** Sets several move attributes, by their names on the Moves tab. */
function set(h: Hitbox, values: Partial<Record<MoveAttribute, number>>): void {
  for (const [name, v] of Object.entries(values)) h.setAttribute(name as MoveAttribute, v);
}
/** Adds to a move attribute, rounding the result if `round` is true. */
function add(h: Hitbox, name: MoveAttribute, by: number, round = false): void {
  const v = Number(h.attribute(name)) + by;
  h.setAttribute(name, round ? Math.round(v) : v);
}

function dodge(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 6)) {
    h.active = false;
    f.vx += f.direction === 90 ? 2 : -2;
  }
  h.phase(2, 6);
  if (h.phase(3, 1)) {
    f.switchTo('idle');
    h.remove();
  }
}

/**
 * NPunch: charges while attack is held, up to 50 frames. Let go after more than 10 frames for one big bite,
 * or sooner for two quick ones. Slot 1 is the frame it was let go on and slot 2 the charge.
 */
function npunch(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.ghost = 100;
    h.active = false;
  }
  let release = h.slot(1);
  const charge = h.slot(2);
  if (!release && f.buttons.attack) {
    if (charge < 50) {
      h.setSlot(2, charge + 1);
      if (charge + 1 === 50) h.playSound('Charged');
    }
    f.lists.C_Charging[f.index - 1] = h.slot(2);
  } else if (!release) {
    if (charge > 10) {
      h.size += charge * 2;
      add(h, 'hitboxWidth', charge / 5);
      add(h, 'hitboxHeight', charge / 5);
      add(h, 'knockbackX', charge / 1.5);
      add(h, 'knockbackY', charge / 3.5);
      add(h, 'hitstun', charge / 6);
      add(h, 'comboGain', charge, true);
      add(h, 'knockbackScalingX', charge / 2, true);
      add(h, 'knockbackScalingY', charge, true);
      add(h, 'hitstunScaling', charge, true);
    } else {
      set(h, { knockbackX: 2, knockbackY: 1, hitstun: 5, damage: 2, iframes: 5, comboGain: 7, knockbackScalingX: 4, knockbackScalingY: 1, hitstunScaling: 6 });
    }
    f.lists.C_Charging[f.index - 1] = 0;
    h.ghost = 0;
    h.playSound('hit3');
    h.active = true;
    release = L;
    h.setSlot(1, L);
  }
  if (!release) return;
  if (charge > 10) {
    if (L <= release + 11) {
      h.offsetX += 2;
      h.ghost += 3;
    } else h.remove();
  } else if (L <= release + 6) {
    h.offsetX += 2;
    h.ghost += 5;
  } else if (L === release + 7) {
    h.offsetX -= 16;
    h.playSound('hit3');
    h.ghost = 0;
    h.setAttribute('knockbackX', 2);
  } else if (L <= release + 13) {
    h.offsetX += 2;
    h.ghost += 5;
  } else h.remove();
}

/** E3, Big Bite: a grab holds the target while Gnaw shuffles forward, then the bite hits hard and heals him. */
function bite(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) {
    h.copy('BiteGrab');
    h.knockbackAdds = true;
  }
  if (h.phase(2, 13)) {
    h.offsetX += 1.5;
    set(h, { hitboxHeight: Number(h.attribute('hitboxHeight')) * 0.99, knockbackX: -0.2 });
    f.invincibility = 3;
  }
  if (h.phase(3, 2)) {
    h.active = false;
    set(h, { hitboxWidth: 35, displacementX: -20 });
    h.offsetX -= 10;
    h.playSound('E3-1_impact');
  }
  if (h.phase(4, 3)) {
    h.active = true;
    h.knockbackAdds = false;
    set(h, { hitboxWidth: 30, displacementX: -25, knockbackX: 17, knockbackY: 13, iframes: 20, hitstun: 15, damage: 25, comboGain: 20, knockbackScalingX: 38, knockbackScalingY: 27, hitstunScaling: 20, diScaling: 4 });
  }
  if (h.phase(5, 1)) h.remove();
}

/** A flame: it arcs, turns to face its path, and leaves fire where it lands. */
function flame(f: Fighter, h: Hitbox): void {
  h.outlivesFighter = true;
  h.moveBy(h.vx, h.vy);
  const facing = h.direction < 0 ? -1 : 1;
  h.heading = f.math.atan(h.vy / (6 * facing));
  h.rotation = facing < 0 ? -(h.heading + 90) : -(h.heading - 90);
  h.vy -= 0.5;
  if (h.hitGround) {
    h.vy = 1;
    h.vx = h.vx * 0.1;
    h.rotation = 90;
    h.copy('FlameGround');
    h.remove();
  }
}

export default {
  tick(f, h) {
    const L = life(h);
    switch (h.name) {
      case 'Taunt':
        h.remove();
        break;
      case 'Dodge':
        dodge(f, h);
        break;
      case 'NPunch':
        npunch(f, h);
        break;
      case 'RunPunch':
        if (h.phase(1, 7)) h.offsetX += 4;
        if (h.phase(2, 3)) {
          set(h, { damage: 8, iframes: 2, knockbackY: 0, knockbackScalingX: 35, knockbackScalingY: -1, hitstunScaling: 8 });
          h.offsetX += 4;
        }
        if (h.phase(3, 1)) h.remove();
        break;
      case 'UpPunch':
        if (L <= 9) h.offsetY += 2;
        else h.remove();
        break;
      case 'DownPunch':
        // A slide along the ground that slows down. Slots 1 and 2 are its speed.
        if (L === 1) {
          h.setSlot(1, 7 + Math.abs(f.vx) / 1.5);
          h.setSlot(2, 0);
        }
        if (L <= 12) {
          h.moveBy(h.slot(1), h.slot(2));
          h.setSlot(1, h.slot(1) * 0.87);
          h.setSlot(2, h.slot(2) - 1);
          add(h, 'knockbackScalingY', -0.5);
        } else h.remove();
        break;
      case 'DownAirPunch':
        if (L === 1) {
          h.endsOnLanding = true;
          f.vy = 2;
        }
        if (L <= 15) {
          f.vy += 0.4;
          if (f.buttons.right) f.vx += f.slot(STEER);
          if (f.buttons.left) f.vx -= f.slot(STEER);
        } else {
          f.setSlot(STEER, f.slot(STEER) * 0.5);
          h.remove();
        }
        break;
      case 'E1':
        // Fireball: a flame thrown forward, higher with up held (Gnaw jumps too), or low with down held.
        if (L === 3) {
          h.follows = false;
          let speed: [number, number] = [6, 5];
          if (f.buttons.up) {
            f.vy = 10;
            speed = [3, 10];
            h.particle('06_DJumpCloud', 0, 0, 2);
          } else if (f.buttons.down) speed = [5, 1];
          [h.vx, h.vy] = speed;
          // The flame is a copy of this hitbox, so it starts here with this speed.
          h.copy('Flame');
        }
        if (L >= 3) h.remove();
        break;
      case 'E3':
        bite(f, h);
        break;
      case 'BiteGrab':
        if (h.phase(1, 13)) {
          h.grabs = true;
          h.active = true;
          h.holdAt(20, 0);
        }
        if (h.phase(2, 1)) {
          h.grabs = false;
          h.release();
          h.remove();
        }
        break;
      case 'E5':
        // Fire Barrage: Gnaw hovers and breathes seven flames, each one further and lower.
        h.active = false;
        if (L === 1) {
          h.addModifier(f, 'No100Combo');
          h.vx = 1;
          h.vy = 12;
        }
        if (L <= 6) f.vy = 1;
        if (L === 6) {
          if (f.buttons.up) f.vy = 15;
          h.playSound('Firebreath');
        }
        if (L >= 7 && L <= 13) {
          f.invincibility = 3;
          h.copy('Flame');
          h.vx += 1;
          h.vy -= 1;
        }
        if (L >= 14) h.remove();
        break;
      case 'Flame':
        flame(f, h);
        break;
      case 'FlameGround':
        h.outlivesFighter = true;
        if (h.phase(1, 250)) {
          h.vy -= 0.5;
          h.moveBy(h.vx, h.vy);
          h.vx *= 0.9;
        }
        if (h.phase(2, 1)) h.remove();
        break;
      case 'FlameBurst':
        // A copy of a moving flame, which stays where it hit.
        h.outlivesFighter = true;
        h.vx = 0;
        h.vy = 0;
        if (L >= 6) h.remove();
        break;
    }
  },

  hit(fighter, target, hitbox) {
    // The bite heals on the hits its last effect frame lands, as Gnaw's does.
    if (hitbox.name === 'E3' && hitbox.frame >= 13) {
      hitbox.playSound('Heal');
      fighter.percent = Math.max(0, fighter.percent - 30);
    }
    // A flame bursts on its last hit.
    if ((hitbox.name === 'Flame' || hitbox.name === 'FlameGround') && Number(hitbox.attribute('hitsBeforeDeletion')) === 1) hitbox.copy('FlameBurst');
  },
} satisfies Gimmick;
