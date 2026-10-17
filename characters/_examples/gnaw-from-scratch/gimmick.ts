import type { Fighter, Gimmick, Hitbox } from '@characters/api';

// Gnaw's moves, made with the mod maker alone. Every move is this character's own data on the Moves tab,
// and this script does what Gnaw's built-in move scripts do. `life` counts a hitbox's frames from 1, as
// Gnaw's scripts do, so the numbers below are the ones in his scripts.
//
// Gimmick slot 1 is DownAirPunch's sideways push, halved after each use and back to 1 on the ground.
// NPunch keeps the life frame it was let go on in its hitbox's slot 1, and its charge in slot 2.
const STEER = 1;

const life = (h: Hitbox) => h.frame + 1;
const forward = (f: Fighter) => (f.direction < 0 ? -1 : 1);
const onGround = (f: Fighter) => Number(f.lists.Collision_Players_Plat_Num?.[f.index - 1] ?? 0) > 0;

/** Sets several move attributes at once. */
function attrs(h: Hitbox, values: Record<string, number>): void {
  for (const [k, v] of Object.entries(values)) h.setAttribute(k as Parameters<Hitbox['setAttribute']>[0], v);
}
const add = (h: Hitbox, name: Parameters<Hitbox['setAttribute']>[0], by: number) => h.setAttribute(name, Number(h.attribute(name)) + by);

/** NPunch charges while attack is held, up to 50 frames, and a charge over 10 makes it bigger and stronger. */
function npunch(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) h.active = false;
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
      add(h, 'hitboxWidth', charge / 5);
      add(h, 'hitboxHeight', charge / 5);
      add(h, 'knockbackX', charge / 1.5);
      add(h, 'knockbackY', charge / 3.5);
      add(h, 'hitstun', charge / 6);
      h.setAttribute('comboGain', Math.round(Number(h.attribute('comboGain')) + charge));
      h.setAttribute('knockbackScalingX', Math.round(Number(h.attribute('knockbackScalingX')) + charge / 2));
      h.setAttribute('knockbackScalingY', Math.round(Number(h.attribute('knockbackScalingY')) + charge));
      h.setAttribute('hitstunScaling', Math.round(Number(h.attribute('hitstunScaling')) + charge));
    } else {
      attrs(h, { knockbackX: 2, knockbackY: 1, hitstun: 5, damage: 2, iframes: 5, comboGain: 7, knockbackScalingX: 4, knockbackScalingY: 1, hitstunScaling: 6 });
    }
    f.lists.C_Charging[f.index - 1] = 0;
    h.playSound('hit3');
    h.active = true;
    release = L;
    h.setSlot(1, L);
  }
  if (!release) return;
  if (charge > 10) {
    if (L <= release + 11) h.offsetX += 2;
    else h.remove();
  } else if (L <= release + 6) h.offsetX += 2;
  else if (L === release + 7) {
    h.offsetX -= 16;
    h.playSound('hit3');
    h.setAttribute('knockbackX', 2);
  } else if (L <= release + 13) h.offsetX += 2;
  else h.remove();
}

/**
 * The phases of a move that run on a life frame, given each phase's length. As in Gnaw's scripts, a phase
 * starts on the last frame of the one before, so two phases run on that frame, in order.
 */
function phases(L: number, lengths: number[]): number[] {
  const on: number[] = [];
  let start = 1;
  lengths.forEach((n, i) => {
    if (L >= start && L <= start + n - 1) on.push(i + 1);
    start += n - 1;
  });
  return on;
}

/** E3, Big Bite: a grab hitbox holds the target while Gnaw shuffles forward, then the bite hits hard and heals. */
function bite(f: Fighter, h: Hitbox): void {
  for (const p of phases(life(h), [1, 13, 2, 3, 1])) {
    if (p === 1) {
      h.copy('BiteGrab');
      h.knockbackAdds = true;
    } else if (p === 2) {
      h.offsetX += 1.5;
      h.setAttribute('hitboxHeight', Number(h.attribute('hitboxHeight')) * 0.99);
      h.setAttribute('knockbackX', -0.2);
      f.invincibility = 3;
    } else if (p === 3) {
      h.active = false;
      attrs(h, { hitboxWidth: 35, displacementX: -20 });
      h.offsetX -= 10;
      h.playSound('E3-1_impact');
    } else if (p === 4) {
      h.active = true;
      h.knockbackAdds = false;
      attrs(h, { hitboxWidth: 30, displacementX: -25, knockbackX: 17, knockbackY: 13, iframes: 20, hitstun: 15, damage: 25, comboGain: 20, knockbackScalingX: 38, knockbackScalingY: 27, hitstunScaling: 20, diScaling: 4 });
    } else h.remove();
  }
}

/** The flame Gnaw spits: it arcs, turns to face its path, and leaves fire where it lands. */
function flame(f: Fighter, h: Hitbox): void {
  h.moveBy(h.vx, h.vy);
  const facing = h.direction < 0 ? -1 : 1;
  const turn = f.math.atan(h.vy / (6 * facing));
  h.rotation = facing < 0 ? -(turn + 90) : -(turn - 90);
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
  frame(fighter) {
    if (onGround(fighter)) fighter.setSlot(STEER, 1);
  },

  tick(f, h) {
    const L = life(h);
    switch (h.name) {
      case 'Taunt':
        h.remove();
        break;
      case 'Dodge':
        for (const p of phases(L, [6, 6, 1])) {
          if (p === 1) {
            h.active = false;
            f.vx += 2 * forward(f);
          } else if (p === 3) {
            f.switchTo('idle');
            h.remove();
          }
        }
        break;
      case 'NPunch':
        npunch(f, h);
        break;
      case 'RunPunch':
        for (const p of phases(L, [7, 3, 1])) {
          if (p === 2) attrs(h, { damage: 8, iframes: 2, knockbackY: 0, knockbackScalingX: 35, knockbackScalingY: -1, hitstunScaling: 8 });
          if (p < 3) h.offsetX += 4;
          else h.remove();
        }
        break;
      case 'UpPunch':
        if (L <= 9) h.offsetY += 2;
        else h.remove();
        break;
      case 'DownPunch':
        // A projectile of a character with no template: the game moves it by vx and vy after this.
        if (L === 1) {
          h.vx = 7 + Math.abs(f.vx) / 1.5;
          h.vy = 0;
        } else {
          h.vx *= 0.87;
          h.vy -= 1;
        }
        if (L <= 12) add(h, 'knockbackScalingY', -0.5);
        else h.remove();
        break;
      case 'DownAirPunch':
        if (onGround(f)) {
          h.remove();
          break;
        }
        if (L === 1) f.vy = 2;
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
        if (L === 3) {
          // The flame is a copy of this hitbox, so it starts here with this speed.
          h.follows = false;
          let speed: [number, number] = [6, 5];
          if (f.buttons.up) {
            f.vy = 10;
            speed = [3, 10];
            h.particle('06_DJumpCloud', 0, 0, 2);
          } else if (f.buttons.down) speed = [5, 1];
          [h.vx, h.vy] = speed;
          h.copy('Flame');
        }
        if (L >= 3) h.remove();
        break;
      case 'E3':
        bite(f, h);
        break;
      case 'BiteGrab':
        for (const p of phases(L, [13, 1])) {
          if (p === 1) {
            h.grabs = true;
            h.active = true;
            h.holdAt(20, 0);
          } else {
            h.grabs = false;
            h.remove();
          }
        }
        break;
      case 'E5':
        h.active = false;
        if (L === 1) {
          // The "Best" combo setting does not refill the meter during the barrage.
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
        h.vy -= 0.5;
        h.moveBy(h.vx, h.vy);
        h.vx *= 0.9;
        if (L >= 250) h.remove();
        break;
      case 'FlameBurst':
        // It is a copy of a moving flame, and stays where it hit.
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
    if (hitbox.name === 'Flame' || hitbox.name === 'FlameGround') hitbox.copy('FlameBurst');
  },
} satisfies Gimmick;
