import type { Fighter, Gimmick, Hitbox } from '@characters/api';

// Darc's moves, made with the mod maker alone. Every move is this character's own data on the Moves tab,
// and this script does what Darc's built-in move scripts do, phase by phase. E1 follows the built-in rules
// of Darc's grapple and ZoneHitbox those of Darc's zone, chosen on the Moves tab, so the game draws the
// grapple's line, marks what it catches and knocks out a fighter the zone finishes. `life` counts a
// hitbox's frames from 1, as Darc's scripts do.
//
// Hitbox slot 1 is NPunch's release frame, UpPunch's spin, the scarf's count, the grapple's speed and the
// zone's layer. The grapple keeps what it caught in slot 2 ("ENEMY", "TERRAIN" or 0), whether it has
// latched in slot 3, and how it was aimed in slot 4. Gimmick slot 2 is the grapple's distance to Darc and
// slot 3 the fighter it aims at.

const life = (h: Hitbox) => h.frame + 1;
/** The game turns a result that is not a number, such as acos of 2, into 0. */
const num = (v: number) => (Number.isNaN(v) ? 0 : v);

/** Move attributes by their number in the game's move data (1 is hitbox width, 7 knockback X, and on). */
const FIELDS = ['hitboxWidth', 'hitboxHeight', 'displacementX', 'displacementY', 'pushbackX', 'pushbackY', 'knockbackX', 'knockbackY', 'iframes', 'hitstun', 'damage', 'hitsBeforeDeletion', 'rotateStyle', 'comboGain', 'knockbackScalingX', 'knockbackScalingY', 'hitstunScaling', 'diScaling', 'cloneType'] as const;
function attrs(h: Hitbox, values: Record<number, number>): void {
  for (const [i, v] of Object.entries(values)) h.setAttribute(FIELDS[Number(i) - 1], v);
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

/** UpPunch spins the blade up and around, lifting Darc, and hits harder on its last turn. */
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
    h.rotation += (num(f.math.acos(h.slot(1))) - 1) * 60;
    if (h.slot(1) === 50) attrs(h, { 7: 0, 8: 0, 9: 1, 10: 1, 11: 3, 15: 4, 16: 2, 17: 2, 18: 0 });
    if (h.slot(1) === 120) attrs(h, { 7: 15, 8: 2, 9: 7, 10: 12, 11: 8, 15: 9, 16: -1, 17: 3, 18: 4 });
    if (f.buttons.right) f.vx += 1;
    if (f.buttons.left) f.vx += -1;
  }
  if (h.phase(3, 1)) h.remove();
}

const DIRECTED = 1;
const AIMED = 2;

/** Puts the hitbox on the fighter it aims at, at its offset, as the game puts a hitbox on its own fighter. */
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
      if (b.right) h.vx += 10;
      if (b.left) h.vx += -10;
      if (b.up) h.vy += 10;
      if (b.down) h.vy += -10;
      f.setSlot(3, h.closestEnemy()?.index ?? 0);
      h.pointAt(h.x + h.vx, h.y + h.vy);
      h.setSlot(4, DIRECTED);
      h.setSlot(1, 35);
    } else {
      const e = h.closestEnemy();
      f.setSlot(3, e?.index ?? 0);
      h.pointAt(e?.x ?? 0, e?.y ?? 0);
      h.setSlot(4, AIMED);
      h.setSlot(1, 30);
    }
  }
  if (h.phase(3, 10)) {
    f.vy = 1;
    f.vx = 0;
    h.setSlot(1, h.slot(1) + -4);
    h.moveSteps(h.slot(1), h.heading + 1);
    const ground = h.platform();
    if ((h.hitWall || h.hitGround) && h.slotText(2) !== 'ENEMY' && (ground === 1 || h.slot(4) === DIRECTED)) {
      h.setSlot(2, 'TERRAIN');
      h.moveSteps(10, h.heading, false);
    }
    if (h.slotText(2) === 'ENEMY' || h.slotText(2) === 'TERRAIN') h.endPhase(3);
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
    if (h.slotText(2) === 'ENEMY') {
      h.setSlot(1, h.slot(4) === DIRECTED ? 10 : 3);
      const [sin, cos] = [f.math.sin(h.heading), f.math.cos(h.heading)];
      attrs(h, { 7: -15 * sin, 8: -12 * cos, 9: 6, 10: 15, 11: h.slot(1), 14: 6, 15: -12 * sin, 16: -12 * cos, 17: 2, 18: 8 });
      onTarget(f, h);
      h.playSound('hit1');
    }
    if (h.slotText(2) === 'TERRAIN') {
      f.jumps = 1;
      f.setSlot(2, distance(f, h));
    }
    h.setSlot(3, 1);
  }
  if (h.slot(3) === 1) {
    if (h.slotText(2) === 'ENEMY') {
      if (h.phase(8, 3)) onTarget(f, h);
      if (h.phase(9, 2)) {
        h.ghost += 25;
        h.moveSteps(-20, h.heading, false);
      }
      if (h.phase(10, 1)) h.remove();
    } else {
      if (h.slotText(2) === 'TERRAIN') {
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
  // vx and vy only aim the grapple, and the game would otherwise move it by them.
  h.vx = 0;
  h.vy = 0;
}

/** E3, the portal: three portals open by the closest enemy, and each sends a slash at Darc's place. */
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

function portalSlash(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    const [sin, cos] = [f.math.sin(h.heading), f.math.cos(h.heading)];
    attrs(h, { 7: 16 * sin, 8: 16 * cos, 15: 20 * sin, 16: 20 * cos, 17: 7 });
    h.playSound('NPunch-6_');
  }
  if (h.phase(1, 5)) h.moveSteps(5, h.heading, false);
  h.phase(2, 10);
  if (h.phase(3, 1)) h.remove();
}

/** E5, the zone: dark layers around Darc and eight hitboxes around the stage that pull toward him. */
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

/** Moves a hitbox onto its fighter at its offset, without stopping at walls. */
const follow = (f: Fighter, h: Hitbox) => h.moveBy(f.x + h.offsetX - h.x, f.y + h.offsetY - h.y, false);

function zoneLayer(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.active = false;
    h.ghost = 100;
    h.size = 280;
    h.animation = `Zone${h.slot(1)}${h.slotText(2)}`;
  }
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
const ZONE: Record<number, [number, number, Record<number, number>]> = {
  1: [240, 0, { 1: 160, 2: 800, 7: -15, 8: 0, 15: -15 }],
  2: [-240, 0, { 1: 160, 2: 800, 7: 15, 8: 0, 15: 15 }],
  3: [0, 240, { 1: 1000, 2: 160, 7: 0, 8: -15, 16: -15 }],
  4: [0, -240, { 1: 1000, 2: 160, 7: 0, 8: 15, 16: 15 }],
  5: [140, 140, { 1: 80, 2: 80, 7: -12, 8: -12, 15: -10, 16: -10 }],
  6: [140, -140, { 1: 80, 2: 80, 7: -12, 8: 12, 15: -10, 16: 10 }],
  7: [-140, -140, { 1: 80, 2: 80, 7: 12, 8: 12, 15: 10, 16: 10 }],
  8: [-140, 140, { 1: 80, 2: 80, 7: 12, 8: -12, 15: 10, 16: -10 }],
};

function zoneHitbox(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.noHitPause = true;
    h.direction = 90;
    h.ghost = 100;
    const z = ZONE[h.slot(1)];
    if (z) {
      h.offsetX += z[0];
      h.offsetY += z[1];
      attrs(h, z[2]);
    }
  }
  if (h.phase(1, 310)) {
    follow(f, h);
    h.pointAt(f.x, f.y);
    attrs(h, { 7: 15 * f.math.sin(h.heading), 8: 12 * f.math.cos(h.heading) });
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
          if (h.slot(1) === 10) attrs(h, { 7: 12, 8: 12, 9: 15, 11: 3, 15: 6, 16: 4, 17: 10, 18: 3 });
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
