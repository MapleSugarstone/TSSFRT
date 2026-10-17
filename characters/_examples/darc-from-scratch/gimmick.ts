import type { Fighter, Gimmick, Hitbox, MoveAttribute } from '@characters/api';

// Darc From Scratch: every move is this character's own data on the Moves tab, and this script moves the
// hitboxes the way Darc's move scripts do. On the Moves tab, E1 follows the built-in rules of Darc's
// grapple and ZoneHitbox those of Darc's zone. So the game draws the grapple's line, writes "ENEMY" to its
// slot 2 when it catches a fighter, and knocks out a fighter the zone finishes.
//
// How to read it: `tick` runs every frame for each hitbox, and the switch at the bottom picks the move by
// name. Most moves run in phases: `h.phase(1, 6)` is true for the hitbox's first 6 frames, `h.phase(2, 20)`
// for the 20 after those, and so on. As in the original scripts, a phase starts on the last frame of the one
// before it. `life(h)` is the hitbox's frame, counted from 1.

const life = (h: Hitbox) => h.frame + 1;
/** The game turns a result that is not a number, such as acos of 2, into 0. */
const num = (v: number) => (Number.isNaN(v) ? 0 : v);

/** Sets several move attributes, by their names on the Moves tab. */
function set(h: Hitbox, values: Partial<Record<MoveAttribute, number>>): void {
  for (const [name, v] of Object.entries(values)) h.setAttribute(name as MoveAttribute, v);
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

/** UpPunch: the blade spins up and around, lifting Darc, and hits harder on its last turn. Slot 1 counts the spin. */
function upPunch(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.playSound('2darcsword5');
    h.setSlot(1, 0);
    h.ghost = 100;
  }
  if (h.phase(1, 6)) f.vy += 1;
  if (h.phase(2, 20)) {
    h.ghost = 0;
    f.vy += 0.5;
    h.setSlot(1, h.slot(1) + 10);
    h.moveBy(0, 0, false);
    h.offsetY = 20 + f.math.sin(h.slot(1)) * 25;
    // acos of a number over 1 is not a number, which the game makes 0, so this turns the blade back 60 degrees.
    h.rotation += (num(f.math.acos(h.slot(1))) - 1) * 60;
    if (h.slot(1) === 50) set(h, { knockbackX: 0, knockbackY: 0, iframes: 1, hitstun: 1, damage: 3, knockbackScalingX: 4, knockbackScalingY: 2, hitstunScaling: 2, diScaling: 0 });
    if (h.slot(1) === 120) set(h, { knockbackX: 15, knockbackY: 2, iframes: 7, hitstun: 12, damage: 8, knockbackScalingX: 9, knockbackScalingY: -1, hitstunScaling: 3, diScaling: 4 });
    if (f.buttons.right) f.vx += 1;
    if (f.buttons.left) f.vx += -1;
  }
  if (h.phase(3, 1)) h.remove();
}

/** Puts the hitbox on the fighter the grapple aims at (gimmick slot 3), as the game puts a hitbox on its own fighter. */
function onTarget(f: Fighter, h: Hitbox): void {
  const e = f.all()[f.slot(3) - 1];
  if (!e) return;
  h.x = e.x + h.offsetX * (90 / e.direction);
  h.y = e.y + h.offsetY;
}

const distance = (f: Fighter, h: Hitbox) => Math.sqrt((f.x - h.x) * (f.x - h.x) + (f.y - h.y) * (f.y - h.y));

/**
 * E1, the grapple: thrown the way a direction is held, or at the closest enemy. It pulls in a fighter it
 * catches, or pulls Darc to a wall or the ground it sticks in.
 *
 * Hitbox slots: 1 is the grapple's speed, 2 what it caught ("ENEMY" from the game, or "TERRAIN"), 3 is 1
 * once it has latched, and 4 is "directed" or "undirected". Gimmick slot 2 is its distance to Darc and
 * gimmick slot 3 the fighter it aims at.
 */
function grapple(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    const rotation = h.rotation;
    h.direction = 90;
    h.rotation = rotation;
    h.y = h.y + 10;
    h.vx = 0;
    h.vy = 0;
    h.setSlot(2, 0);
    h.setSlot(3, 0);
  }
  if (h.phase(1, 4)) f.vy = 2;
  if (h.phase(2, 1)) {
    const b = f.buttons;
    if (b.down || b.up || b.left || b.right) {
      // vx and vy only hold the aim here.
      if (b.right) h.vx += 10;
      if (b.left) h.vx += -10;
      if (b.up) h.vy += 10;
      if (b.down) h.vy += -10;
      f.setSlot(3, h.closestEnemy()?.index ?? 0);
      h.pointAt(h.x + h.vx, h.y + h.vy);
      h.setSlot(4, 'directed');
      h.setSlot(1, 35);
    } else {
      const e = h.closestEnemy();
      f.setSlot(3, e?.index ?? 0);
      h.pointAt(e?.x ?? 0, e?.y ?? 0);
      h.setSlot(4, 'undirected');
      h.setSlot(1, 30);
    }
  }
  const caught = () => h.slotText(2);
  if (h.phase(3, 10)) {
    f.vy = 1;
    f.vx = 0;
    h.setSlot(1, h.slot(1) + -4);
    h.moveSteps(h.slot(1), h.heading + 1);
    // An undirected grapple only sticks in solid ground (platform 1).
    const ground = h.platform();
    if ((h.hitWall || h.hitGround) && caught() !== 'ENEMY' && (ground === 1 || h.slotText(4) === 'directed')) {
      h.setSlot(2, 'TERRAIN');
      h.moveSteps(10, h.heading, false);
    }
    if (caught() === 'ENEMY' || caught() === 'TERRAIN') h.endPhase(3);
  }
  if (h.phase(4, 2)) {
    f.vy = 1;
    f.vx = 0;
  }
  if (h.phase(5, 1)) {
    h.animation = 'GrappleHit';
    h.playSound('BiteImpct2');
  }
  if (h.phase(6, 3)) {
    f.vy = 1;
    f.vx = 0;
  }
  if (h.phase(7, 1)) {
    h.playSound('darcgrapple');
    if (caught() === 'ENEMY') {
      h.setSlot(1, h.slotText(4) === 'directed' ? 10 : 3);
      const [sin, cos] = [f.math.sin(h.heading), f.math.cos(h.heading)];
      set(h, { knockbackX: -15 * sin, knockbackY: -12 * cos, iframes: 6, hitstun: 15, damage: h.slot(1), comboGain: 6, knockbackScalingX: -12 * sin, knockbackScalingY: -12 * cos, hitstunScaling: 2, diScaling: 8 });
      onTarget(f, h);
      h.playSound('hit1');
    }
    if (caught() === 'TERRAIN') {
      f.jumps = 1;
      f.setSlot(2, distance(f, h));
    }
    h.setSlot(3, 1);
  }
  if (h.slot(3) === 1) {
    if (caught() === 'ENEMY') {
      // Hold the caught fighter's place, then pull back to Darc and fade.
      if (h.phase(8, 3)) onTarget(f, h);
      if (h.phase(9, 2)) {
        h.ghost += 25;
        h.moveSteps(-20, h.heading, false);
      }
      if (h.phase(10, 1)) h.remove();
    } else {
      if (caught() === 'TERRAIN') {
        // Pull Darc toward the grapple until he is close to it.
        if (h.phase(8, 4 + Math.round(h.slot(1) / 2))) {
          if (f.slot(2) < 35) {
            h.endPhase(8);
            if (f.vy < 0) f.vy = 10;
          } else {
            f.vy = 18 * f.math.cos(h.heading);
            f.vx = 15 * f.math.sin(h.heading);
            f.setSlot(2, distance(f, h));
          }
        }
      } else if (h.phase(8, 2)) {
        h.moveSteps(-20, h.heading, false);
        h.ghost += 25;
      }
      if (h.phase(9, 1)) h.remove();
    }
  }
  // The game moves a projectile by its vx and vy unless the script moved it, and the grapple moves itself.
  h.vx = 0;
  h.vy = 0;
}

/** E3, the portals: three portals open by the closest enemy, and each sends a slash at Darc's place. */
function portals(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    f.invincibility = 3;
    h.active = false;
    h.direction = 90;
    h.ghost = 100;
  }
  if (h.phase(1, 5)) f.invincibility = 3;
  if (h.phase(2, 1)) h.ghost = 0;
  if (h.phase(3, 5)) {
    f.invincibility = 3;
    h.setAttribute('displacementY', Number(h.attribute('displacementY')) + 8);
    h.offsetY += 8;
    h.setAttribute('displacementX', Number(h.attribute('displacementX')) + 1);
    h.offsetX += 2;
    h.ghost += 15;
  }
  const open = () => {
    h.follows = false;
    h.ghost += 20;
    h.copy('Portal');
  };
  const drift = () => {
    const x = f.random(-1, 1);
    const y = f.random(-1, 1);
    h.offsetX += x;
    h.offsetY += y;
  };
  if (h.phase(4, 1)) open();
  if (h.phase(5, 22)) drift();
  if (h.phase(6, 1)) open();
  if (h.phase(7, 22)) drift();
  if (h.phase(8, 1)) open();
  if (h.phase(9, 22)) drift();
  if (h.phase(10, 1)) h.remove();
}

/** A portal: it follows the closest enemy (slot 1), placed 30 steps toward Darc, and sends one slash. */
function portal(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.active = false;
    h.direction = 90;
    h.ghost = 100;
    h.setSlot(1, h.closestEnemy()?.index ?? 0);
  }
  if (h.phase(1, 15)) {
    h.ghost -= 25;
    const e = f.all()[h.slot(1) - 1];
    h.x = e ? e.x : 0;
    h.y = e ? e.y : 0;
    h.pointAt(f.x, f.y);
    h.moveSteps(-30, h.heading, false);
  }
  if (h.phase(2, 1)) h.copy('PortalSlash');
  if (h.phase(3, 15)) h.ghost += 5;
  if (h.phase(4, 1)) h.remove();
}

/** The portal's slash flies toward Darc's place and knocks along its path. */
function portalSlash(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    const [sin, cos] = [f.math.sin(h.heading), f.math.cos(h.heading)];
    set(h, { knockbackX: 16 * sin, knockbackY: 16 * cos, knockbackScalingX: 20 * sin, knockbackScalingY: 20 * cos, hitstunScaling: 7 });
    h.playSound('NPunch-6_');
  }
  if (h.phase(1, 5)) h.moveSteps(5, h.heading, false);
  h.phase(2, 10);
  if (h.phase(3, 1)) h.remove();
}

/**
 * E5, the zone: three dark layers around Darc and eight hitboxes around the stage that pull toward him.
 * Slot 1 numbers the copies: layers 3, 2 and 1, then hitboxes 1 to 8. Slot 2 is a layer's "Line" or "BG".
 */
function zone(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.addModifier(f, 'No100Combo');
    h.playSound('dark caura');
    h.active = false;
    h.survivesHits = true;
    h.direction = 90;
    h.setSlot(1, 4);
    h.setSlot(2, 0);
  }
  if (h.phase(1, 3)) {
    h.setSlot(1, h.slot(1) + -1);
    h.setSlot(2, 'Line');
    h.copy('ZoneLayer');
    h.setSlot(2, 'BG');
    h.copy('ZoneLayer');
  }
  if (h.phase(2, 8)) {
    h.copy('ZoneHitbox');
    h.setSlot(1, h.slot(1) + 1);
  }
  if (h.phase(3, 1)) h.remove();
}

/** Moves a hitbox onto its fighter at its offset, through walls. */
const follow = (f: Fighter, h: Hitbox) => h.moveBy(f.x + h.offsetX - h.x, f.y + h.offsetY - h.y, false);

function zoneLayer(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.active = false;
    h.ghost = 100;
    h.size = 280;
    h.animation = `Zone${h.slot(1)}${h.slotText(2)}`;
  }
  // Odd layers turn one way and even layers the other.
  const spin = (by: number) => {
    h.rotation += ((h.slot(1) % 2) - 0.5) * by;
  };
  if (h.phase(1, 50)) {
    h.size += -1;
    h.ghost += -2;
    spin(1);
    follow(f, h);
  }
  if (h.phase(2, 250)) {
    spin(2);
    follow(f, h);
  }
  if (h.phase(3, 50)) {
    h.size += 1;
    h.ghost += 2;
    spin(5);
    follow(f, h);
  }
  if (h.phase(4, 1)) h.remove();
}

/** Where each of the eight zone hitboxes sits from Darc, and its size and knockback. */
const ZONE: Record<number, [number, number, Partial<Record<MoveAttribute, number>>]> = {
  1: [240, 0, { hitboxWidth: 160, hitboxHeight: 800, knockbackX: -15, knockbackY: 0, knockbackScalingX: -15 }],
  2: [-240, 0, { hitboxWidth: 160, hitboxHeight: 800, knockbackX: 15, knockbackY: 0, knockbackScalingX: 15 }],
  3: [0, 240, { hitboxWidth: 1000, hitboxHeight: 160, knockbackX: 0, knockbackY: -15, knockbackScalingY: -15 }],
  4: [0, -240, { hitboxWidth: 1000, hitboxHeight: 160, knockbackX: 0, knockbackY: 15, knockbackScalingY: 15 }],
  5: [140, 140, { hitboxWidth: 80, hitboxHeight: 80, knockbackX: -12, knockbackY: -12, knockbackScalingX: -10, knockbackScalingY: -10 }],
  6: [140, -140, { hitboxWidth: 80, hitboxHeight: 80, knockbackX: -12, knockbackY: 12, knockbackScalingX: -10, knockbackScalingY: 10 }],
  7: [-140, -140, { hitboxWidth: 80, hitboxHeight: 80, knockbackX: 12, knockbackY: 12, knockbackScalingX: 10, knockbackScalingY: 10 }],
  8: [-140, 140, { hitboxWidth: 80, hitboxHeight: 80, knockbackX: 12, knockbackY: -12, knockbackScalingX: 10, knockbackScalingY: -10 }],
};

/** A zone hitbox stays at its place around Darc and knocks toward him. */
function zoneHitbox(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.noHitPause = true;
    h.direction = 90;
    h.ghost = 100;
    const z = ZONE[h.slot(1)];
    if (z) {
      h.offsetX += z[0];
      h.offsetY += z[1];
      set(h, z[2]);
    }
  }
  if (h.phase(1, 310)) {
    follow(f, h);
    h.pointAt(f.x, f.y);
    set(h, { knockbackX: 15 * f.math.sin(h.heading), knockbackY: 12 * f.math.cos(h.heading) });
  }
  if (h.phase(2, 1)) h.remove();
}

export default {
  tick(f, h) {
    switch (h.name) {
      case 'Taunt':
        h.remove();
        break;
      case 'Dodge':
        dodge(f, h);
        break;
      case 'NPunch':
        // charge() keeps the frame attack was let go on in slot 1.
        if (h.charge()) break;
        if (life(h) === h.slot(1)) {
          h.ghost = 30;
          h.playSound('NPunch-6_');
          h.playSound('darcsword2');
        }
        if (h.phase(1, 12)) {
          if (f.buttons.right) f.vx += 0.3;
          if (f.buttons.left) f.vx += -0.3;
        }
        h.phase(2, 6);
        if (h.phase(3, 1)) h.remove();
        break;
      case 'RunPunch':
        if (life(h) === 1) {
          h.ghost = 10;
          h.playSound('darcsword3');
        }
        h.phase(1, 1);
        if (h.phase(2, 18)) {
          if (h.direction === 90) {
            if (f.buttons.right) f.vx += 0.7;
          } else if (f.buttons.left) f.vx += -0.7;
        }
        if (h.phase(3, 1)) h.remove();
        break;
      case 'UpPunch':
        upPunch(f, h);
        break;
      case 'DownPunch':
        // The scarf is a second hitbox that sweeps behind.
        if (life(h) === 1) {
          h.ghost = 30;
          h.copy('DownScarf');
        }
        h.phase(1, 20);
        if (h.phase(2, 1)) h.remove();
        break;
      case 'DownScarf':
        if (life(h) === 1) {
          h.ghost = 30;
          h.setSlot(1, 0);
        }
        if (h.phase(1, 20)) {
          h.setSlot(1, h.slot(1) + 1);
          if (h.slot(1) === 10) set(h, { knockbackX: 12, knockbackY: 12, iframes: 15, damage: 3, knockbackScalingX: 6, knockbackScalingY: 4, hitstunScaling: 10, diScaling: 3 });
        }
        if (h.phase(2, 1)) h.remove();
        break;
      case 'DownAirPunch':
        if (life(h) === 1) {
          h.copy('AirScarf');
          h.ghost = 30;
          f.vy = 4;
        }
        h.phase(1, 20);
        if (h.phase(2, 1)) h.remove();
        break;
      case 'AirScarf':
        if (life(h) === 1) {
          h.ghost = 30;
          h.endsOnLanding = true;
        }
        h.phase(1, 20);
        if (h.phase(2, 1)) h.remove();
        break;
      case 'E1':
        grapple(f, h);
        break;
      case 'E3':
        portals(f, h);
        break;
      case 'Portal':
        portal(f, h);
        break;
      case 'PortalSlash':
        portalSlash(f, h);
        break;
      case 'E5':
        zone(f, h);
        break;
      case 'ZoneLayer':
        zoneLayer(f, h);
        break;
      case 'ZoneHitbox':
        zoneHitbox(f, h);
        break;
    }
  },
} satisfies Gimmick;
