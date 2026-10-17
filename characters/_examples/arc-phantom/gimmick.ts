import type { Fighter, Gimmick, Hitbox, MoveAttribute } from '@characters/api';

// Arc Phantom: half Arc and half Phantom. NPunch, RunPunch, DownPunch, Taunt and E5 (Judgement) are Arc's,
// and UpPunch, DownAirPunch, Dodge, E1 (Shadowflame Charge) and E3 (Shadow Trick) are Phantom's. Every move
// is this character's own data on the Moves tab, and this script moves the hitboxes the way Arc's and
// Phantom's move scripts do.
//
// How to read it: `tick` runs every frame for each hitbox, and the switch at the bottom picks the move by
// name. `life(h)` is the hitbox's frame, counted from 1, so `life(h) <= 6` means its first 6 frames.
// Judgement runs in phases instead: `h.phase(1, 8)` is true for the first 8 frames, `h.phase(2, 5)` for the
// 5 after those, and so on. As in the original scripts, a phase starts on the last frame of the one before it.

const life = (h: Hitbox) => h.frame + 1;

/** Sets several move attributes, by their names on the Moves tab. */
function set(h: Hitbox, values: Partial<Record<MoveAttribute, number>>): void {
  for (const [name, v] of Object.entries(values)) h.setAttribute(name as MoveAttribute, v);
}

/** Speeds the fighter up toward the left or right button held. */
function steer(f: Fighter, by: number): void {
  if (f.buttons.right) f.vx += by;
  if (f.buttons.left) f.vx -= by;
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

/** Arc's DownPunch: a stab into the ground that raises a spike ahead and one behind, which knocks straight up. */
function downPunch(h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.ghost = 30;
    h.offsetX += 10;
    h.offsetY += 7;
  }
  if (L >= 10) {
    const dir = h.direction / 90;
    h.playSound('ArcSpikeCrumble');
    h.x += 15 * dir;
    h.copy('Spike');
    h.x += -30 * dir;
    // As in Arc's script, the second spike faces straight up, so it knocks up rather than to a side.
    h.direction = 0;
    h.copy('Spike');
    h.remove();
  }
}

/** A spike: one of four looks, set on the ground, rising, then fading. It ends at once if there is no ground. */
function spike(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.ghost = 100;
    h.animation = ['SpikeA', 'SpikeB', 'SpikeC', 'SpikeD'][f.random(1, 4) - 1];
    h.y += 10;
    h.toGround(100);
    if (!h.hitWall && !h.hitGround) return h.remove();
    h.y += -9;
  }
  if (L <= 3) {
    h.ghost -= 33;
    h.y += 3;
    h.x += h.direction / 90;
  }
  if (L >= 8 && L <= 10) h.ghost += 33;
  if (L === 10) h.remove();
}

/** Judgement's down slash: Arc appears on the held fighter and slashes down. */
function downSlash(f: Fighter, h: Hitbox): void {
  h.playSound('hit9');
  h.release();
  h.active = true;
  h.x = f.x;
  h.y = f.y;
  h.particle('ArcC5Silhouette', 0, 0, 2);
  f.switchTo('Dslsh');
  h.playSound('ArcC5_Hit');
  f.vy = 5;
  h.grabs = false;
}

/** Judgement's up slash, with the silhouette turned the other way. */
function upSlash(f: Fighter, h: Hitbox): void {
  h.playSound('hit9');
  h.particle('ArcC5Silhouette', 10, 15, 2, -90);
  h.release();
  h.active = true;
  f.switchTo('Uslsh');
  h.playSound('ArcC5_Hit');
  f.vy = 5;
  h.grabs = false;
}

/** Between slashes the hitbox holds the fighter again and Arc floats in place. */
function hold(f: Fighter, h: Hitbox): void {
  h.grabs = true;
  f.vy = 1.2;
  f.vx = 0;
}

/** Arc's Judgement: a catch, three pairs of slashes on the held fighter, and a last dash through it. */
function judgement(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.active = true;
    h.playSound('ArcC5-Catch');
    h.playSound('Holy');
    h.playSound('ArcC5_Echo');
  }
  if (h.phase(1, 8)) {
    h.follows = true;
    // As in Arc's script: Judgement has no Can hit window, and turning the window on makes the game read another move's.
    h.windowed = true;
    h.grabs = true;
    f.vx = 0;
    f.vy = 1.2;
    f.invincibility = 5;
  }
  if (h.phase(2, 5)) {
    h.holdAt(20, 0);
    f.vy = 1.2;
  }
  if (L === 8 && h.holding) {
    h.active = false;
    h.playSound('ArcC5-Connect');
  }
  if (h.phase(3, 15)) {
    h.active = false;
    h.holdAt(20, 0);
    f.vy = 1.2;
  }
  if (L === 28) {
    if (!h.holding) {
      h.release();
      return h.remove();
    }
    f.invincibility = 100;
    // Arc's script shows an animation that has no frames here, which hides the hitbox.
    h.animation = 'Hidden';
    h.particle('ArcC5Silhouette', -30, 0, 2);
    h.setAttribute('displacementX', 0);
    h.offsetX -= 30;
    set(h, { hitboxWidth: 60, hitboxHeight: 60, pushbackX: 10, pushbackY: 10, knockbackX: 0, knockbackY: 8, iframes: 5, hitstun: 25, knockbackScalingX: 0, knockbackScalingY: 0, hitstunScaling: 0, diScaling: 0 });
    h.release();
    h.grabs = false;
    h.active = true;
    h.holdAt(30, 0);
    h.setAttribute('damage', 8);
  }
  if (L < 29) return;
  // Three rounds of: down slash, 5 frames, hold for 8, up slash, 5 frames, hold for 8.
  for (let round = 0; round < 3; round++) {
    const p = 4 + round * 6;
    if (h.phase(p, 1)) downSlash(f, h);
    h.phase(p + 1, 5);
    if (h.phase(p + 2, 8)) hold(f, h);
    if (h.phase(p + 3, 1)) upSlash(f, h);
    h.phase(p + 4, 5);
    if (h.phase(p + 5, 8)) hold(f, h);
  }
  if (h.phase(22, 1)) {
    h.grabs = true;
    h.holdAt(30, 0);
    h.active = true;
    h.playSound('ArcC5_Echo');
    h.setAttribute('damage', 13);
  }
  if (h.phase(23, 10)) {
    f.switchTo('LastSlsh');
    f.vx = 0;
    f.vy = 1.2;
  }
  if (h.phase(24, 15)) {
    f.switchTo('LastSlsh');
    f.vx = 0;
    f.vy = 1;
  }
  if (h.phase(25, 1)) {
    // The last slash: Arc dashes through and the hitbox flies ahead of him.
    const dir = h.direction / 90;
    h.playSound('E1-3');
    h.particle('ArcC5Silhouette', -5, 0, 2);
    set(h, { knockbackX: 35, knockbackY: 20, iframes: 4, hitstun: 15, knockbackScalingX: 25, knockbackScalingY: 15, hitstunScaling: 20 });
    h.animation = 'JudgementFinish';
    h.showFrame(2);
    h.x = f.x + 50 * dir;
    h.y = f.y;
    h.rotation = h.direction;
    h.grabs = false;
    h.follows = false;
    f.vx += 100 * dir;
    h.release();
    h.playSound('E1-3_Whoosh');
    h.playSound('hit19');
    h.playSound('ArcC5_LastHit');
    h.ghost = 30;
  }
  if (h.phase(26, 5)) {
    h.ghost += 10;
    f.vx *= 0.7;
    f.vy = 1.2;
  }
  if (h.phase(27, 2)) {
    f.vx *= 0.5;
    f.vy = 1.2;
    h.ghost += 10;
  }
  if (h.phase(28, 1)) {
    f.switchTo('idle');
    f.vy = 6;
    h.remove();
  }
}

/** Phantom's burst of shadowflame: a ring and an explosion, both copies of the hitbox that made them. */
function burst(h: Hitbox): void {
  h.copy('ShadowRing');
  h.copy('ShadowBurst');
}

/**
 * Phantom's Shadowflame Charge: a spinning shadowflame that bursts on a wall, the ground, or the attack
 * button. With up held it bursts at once and Phantom jumps. Slot 1 is how many steps it spins along each
 * frame, and slot 2 how fast it moves forward.
 */
function shadowflame(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.windowed = false;
    h.y += 4;
    h.size = 150;
    h.follows = false;
    if (f.buttons.up) {
      h.y += -20;
      burst(h);
      f.vy = 12;
      return h.remove();
    }
    const held = f.buttons.right || f.buttons.left;
    h.setSlot(2, held ? 6 : 4);
    h.setSlot(1, held ? 2 : 4);
  }
  if (L >= 2 && L <= 202) {
    h.heading += h.direction / 2;
    h.rotation += h.direction / 2;
    h.moveSteps(h.slot(1), h.heading);
    if (f.buttons.attack || h.hitWall || h.hitGround) {
      burst(h);
      return h.remove();
    }
    h.moveBy(h.slot(2), 0);
  }
  if (L >= 202) h.remove();
}

/**
 * Phantom's Shadow Trick: a burst where Phantom stands, then Phantom reappears at the closest enemy, moved
 * by the direction held. Slot 1 is the enemy.
 */
function trick(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.active = false;
    h.follows = false;
    f.invincibility = 20;
    h.setSlot(1, h.closestEnemy()?.index ?? 0);
    burst(h);
    h.size = 400;
  }
  const enemy = f.all()[h.slot(1) - 1];
  if (L <= 10) {
    f.vy = 2;
    h.x = enemy ? enemy.x : 0;
    h.y = enemy ? enemy.y : 0;
    h.rotation += 20;
    h.size -= 10;
  }
  if (L === 11) {
    h.x = enemy ? enemy.x : 0;
    h.y = enemy ? enemy.y : 0;
    h.pointAt(f.x, f.y);
    // These moves pass through platforms fighters can jump through.
    if (f.buttons.down) h.moveSteps(-60, 180, true, true);
    else if (f.buttons.right) h.moveSteps(-40, 90, true, true);
    else if (f.buttons.left) h.moveSteps(40, 90, true, true);
    else if (f.buttons.up) h.toGround(60);
    f.vy = enemy ? enemy.vy : 0;
    f.x = h.x;
    f.y = h.y;
    f.switchTo('idle');
    f.jumps = 2;
  }
  if (L >= 13) h.remove();
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
        // Arc's NPunch charges while attack is held. charge() keeps the frame it was let go on in slot 1.
        if (h.charge()) break;
        if (L === h.slot(1)) {
          h.playSound('NPunch-3_Manual');
          h.ghost = 30;
        }
        if (L >= h.slot(1) + 12) h.remove();
        break;
      case 'RunPunch':
        if (L === 1) h.ghost = 30;
        if (L >= 7 && L <= 14) steer(f, 1);
        if (L >= 15) h.remove();
        break;
      case 'DownPunch':
        downPunch(h);
        break;
      case 'Spike':
        spike(f, h);
        break;
      case 'E5':
        judgement(f, h);
        break;
      case 'UpPunch':
        // Phantom's UpPunch: a spinning rise that hits harder from its 8th frame.
        if (L <= 6) {
          h.offsetY += 2;
          h.rotation += 40;
        } else if (L <= 14) {
          if (L === 8) set(h, { knockbackX: 5, knockbackY: 10, iframes: 7, hitstun: 8, damage: 4, knockbackScalingX: 8, knockbackScalingY: 24, hitstunScaling: 11, diScaling: 3 });
          h.rotation += 40;
        }
        if (L >= 14) h.remove();
        break;
      case 'DownAirPunch':
        // Phantom's DownAirPunch: the hitbox drops to the ground while Phantom dives after it.
        if (L === 1) {
          h.windowed = true;
          h.follows = false;
          h.toGround(40);
          f.vx = 0;
        }
        if (L >= 2 && L <= 12) {
          f.vy = -6;
          if (L === 7) set(h, { displacementY: -30, knockbackX: 9, knockbackY: 9, iframes: 7, hitstun: 12, damage: 4, knockbackScalingX: 16, knockbackScalingY: 10, hitstunScaling: 8, diScaling: 4 });
        }
        if (L >= 12) {
          f.vy = 3;
          h.remove();
        }
        break;
      case 'E1':
        shadowflame(f, h);
        break;
      case 'E3':
        trick(f, h);
        break;
      case 'ShadowBurst':
        if (L <= 10) {
          h.size += 5;
          h.rotation += h.direction / 10;
          set(h, { hitboxWidth: Number(h.attribute('hitboxWidth')) + 2, hitboxHeight: Number(h.attribute('hitboxHeight')) + 2 });
        }
        if (L >= 10) h.remove();
        break;
      case 'ShadowRing':
        if (L <= 10) {
          h.size += 5;
          h.rotation += h.direction / -10;
        }
        if (L >= 10) h.remove();
        break;
    }
  },

  hit(fighter, target, hitbox) {
    // The shadowflame bursts on its last hit.
    if (hitbox.name === 'E1' && Number(hitbox.attribute('hitsBeforeDeletion')) === 1) burst(hitbox);
  },
} satisfies Gimmick;
