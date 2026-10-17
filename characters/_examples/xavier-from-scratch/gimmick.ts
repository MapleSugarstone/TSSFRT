import type { Fighter, Gimmick, Hitbox } from '@characters/api';

// Xavier's moves, made with the mod maker alone. Every move is this character's own data on the Moves tab,
// and this script does what Xavier's built-in move scripts do, phase by phase. His hover comes from
// Xavier's movement rules, chosen on the Overview tab. `life` counts a hitbox's frames from 1, as Xavier's
// scripts do, so the numbers below are the ones in his scripts.
//
// Hitbox slot 1 is NPunch's release frame and then whether it was let go in the air, E1's aim (1 when
// aimed with up or down), DownAirPunch's countdown, E3's dive timer, and E5's frame count.

const life = (h: Hitbox) => h.frame + 1;
const onGround = (f: Fighter) => Number(f.lists.Collision_Players_Plat_Num?.[f.index - 1] ?? 0) > 0;

/** Move attributes by their number in the game's move data (1 is hitbox width, 7 knockback X, and on). */
const FIELDS = ['hitboxWidth', 'hitboxHeight', 'displacementX', 'displacementY', 'pushbackX', 'pushbackY', 'knockbackX', 'knockbackY', 'iframes', 'hitstun', 'damage', 'hitsBeforeDeletion', 'rotateStyle', 'comboGain', 'knockbackScalingX', 'knockbackScalingY', 'hitstunScaling', 'diScaling', 'cloneType'] as const;
function attrs(h: Hitbox, values: Record<number, number>): void {
  for (const [i, v] of Object.entries(values)) h.setAttribute(FIELDS[Number(i) - 1], v);
}

/** Speeds the fighter up toward the left or right button held. */
function steer(f: Fighter, by: number): void {
  if (f.buttons.right) f.vx += by;
  if (f.buttons.left) f.vx -= by;
}

/** A projectile of a character with no template moves by vx and vy unless the script moved it, and Xavier's scripts keep it still. */
function still(h: Hitbox): void {
  h.vx = 0;
  h.vy = 0;
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

/** NPunch charges, then the fighter hops and the orb swings forward, turns and swings back. */
function npunch(f: Fighter, h: Hitbox): void {
  if (h.charge()) return;
  if (life(h) === h.slot(1)) {
    h.setAttribute('comboGain', 7);
    h.ghost = 30;
    const air = !onGround(f);
    f.vy = Number(h.attribute('knockbackY')) / (air ? 2.5 : 1.6);
    h.setSlot(1, air ? 1 : 0);
    h.playSound('NPunch-4_');
  }
  if (h.phase(1, 4)) {
    h.offsetX += 5;
    steer(f, h.slot(1) === 1 ? 2 : 1);
  }
  if (h.phase(2, 1)) {
    h.rotation = h.direction;
    h.offsetX -= 34;
    h.setAttribute('comboGain', 7);
    h.setAttribute('knockbackX', Number(h.attribute('knockbackX')) * -1);
  }
  if (h.phase(3, 1)) {
    const rotation = h.rotation;
    h.direction = -h.direction;
    h.rotation = rotation;
  }
  if (h.phase(4, 5)) {
    h.rotation = -h.rotation;
    h.offsetX -= 5;
    if (h.slot(1) === 1) steer(f, 2);
  }
  if (h.phase(5, 1)) h.remove();
}

/** DownAirPunch drops as a projectile and hits harder near the ground, then lands with a crash. */
function downAir(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) h.moveBy(0, -10);
  h.phase(2, 5);
  if (h.phase(3, 1)) {
    h.follows = false;
    h.ghost = 10;
    h.vy = -5;
    f.vy = 5;
    h.setSlot(1, h.slot(1) + 10);
  }
  if (h.phase(4, 10)) {
    h.setSlot(1, h.slot(1) - 1);
    h.vy += -1;
    h.moveBy(0, h.vy);
    if (h.slot(1) < 6) attrs(h, { 7: 11, 8: 10, 9: 7, 10: 8, 11: 4, 15: 9, 16: 13, 17: 14, 18: 5 });
    if (h.hitWall || h.hitGround) {
      h.endPhase(4);
      attrs(h, { 7: 11, 8: 10, 9: 7, 10: 8, 11: 2, 15: 12, 16: 13, 17: 13, 18: 3 });
      h.playSound('XavierDownAirImpact');
      h.showFrame(4);
      h.toGround(10);
    } else if (h.slot(1) < 1) h.showFrame(6);
  }
  if (h.phase(5, 6)) {
    h.ghost += 15;
    still(h);
  }
  if (h.phase(6, 1)) h.remove();
}

/** E1, Electromagnetic Sphere: an orb thrown in an arc, or straight down at an angle with up or down held. */
function sphere(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) {
    if (f.buttons.down || f.buttons.up) {
      h.setSlot(1, 1);
      h.heading = h.direction * 1.8;
      h.rotation = h.direction * 1.8;
      if (f.buttons.up) f.vy = 10;
      else f.vx = h.direction / -13;
    } else {
      h.setSlot(1, 0);
      h.vy = 2;
    }
  }
  if (h.phase(2, 200)) {
    if (h.slot(1) === 1) h.moveSteps(8, h.heading);
    else {
      h.vy += -0.3;
      h.moveBy(8, h.vy);
    }
    if (h.hitWall || h.hitGround) {
      h.copy('OrbBurst');
      h.remove();
    }
  } else still(h);
}

/** E3, Shockpulse: a dive that, once it lands, sends shockwaves out on both sides three times. */
function shockpulse(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) h.setSlot(1, 20);
  if (h.phase(1, 20)) {
    h.setSlot(1, h.slot(1) - 1);
    f.invincibility = 3;
    f.vy = -20;
    f.vx = h.direction / 20;
    h.moveBy(0, 0);
    if (h.hitWall || h.hitGround) h.endPhase(1);
  }
  if (h.phase(2, 1)) {
    if (h.slot(1) <= 0) return h.remove();
    f.vy = 8;
    h.setSlot(1, 0);
    h.follows = false;
    attrs(h, { 1: 1, 2: 1, 7: 0, 8: 0 });
  }
  if (h.phase(3, 3)) h.moveBy(0, -5);
  const waves = (back: number, ahead: number) => {
    h.moveBy(back, 0);
    h.copy('Shockwave');
    h.moveBy(ahead, 0);
    h.copy('Shockwave');
  };
  if (h.phase(4, 1)) {
    h.playSound('E3-4_Crash');
    waves(-10, 40);
  }
  h.phase(5, 4);
  if (h.phase(6, 1)) waves(-60, 80);
  h.phase(7, 4);
  if (h.phase(8, 1)) waves(-100, 120);
  if (h.phase(9, 1)) h.remove();
}

/** A shockwave sits on the ground, leaves a rune, bounces up and fades. */
function shockwave(h: Hitbox): void {
  if (h.phase(1, 1)) {
    h.size = 200;
    h.toGround(200);
    h.copy('Rune');
    h.active = false;
    h.follows = false;
    h.vy = 3;
  }
  if (h.phase(2, 20)) {
    h.moveBy(0, h.vy);
    h.vy += -1;
  }
  if (h.phase(3, 20)) {
    h.ghost += 5;
    still(h);
  }
  if (h.phase(4, 1)) h.remove();
}

/** A rune floats up behind the fighters, spinning, and fades. */
function rune(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.animation = `Rune${f.random(1, 5)}`;
    h.vy = 6;
    h.behind = true;
  }
  const float = () => {
    h.moveBy(0, h.vy, false);
    h.vy *= 0.8;
    h.rotation += h.vy * 4;
  };
  if (h.phase(1, 10)) float();
  if (h.phase(2, 10)) {
    h.ghost += 10;
    float();
  }
  if (h.phase(3, 1)) h.remove();
}

/** E5, Gravitational Pull: a planet over the stage that makes every enemy fall twice as fast, with shockwaves every second. */
function pull(f: Fighter, h: Hitbox): void {
  const wave = () => f.math.sin(Number(f.vars.Timer) * 100);
  if (life(h) === 1) {
    h.addModifier(f, 'No100Combo');
    h.particle('XavierC5BG', -h.x, -h.y, 1, 0);
    h.playSound('magneticPull');
    h.ghost = 100;
    h.x = 0;
    h.y = 100;
    h.copy('Planet');
    h.setSlot(1, 0);
  }
  if (h.phase(1, 20)) {
    h.ghost -= 5;
    h.rotation += 1;
    h.size += 10;
  }
  if (h.phase(2, 300)) {
    h.ghost = (wave() * 100 + 50) / 2;
    h.behind = true;
    h.setSlot(1, h.slot(1) + 1);
    h.size += wave() * 1;
    h.rotation += 1;
    const n = h.slot(1);
    if (n % 30 === 0) {
      // The shockwaves start on their first frame, as Xavier's do.
      h.animation = 'Shockwave';
      h.showFrame(1);
      h.ghost = 0;
      h.x = (n % 26) * 6;
      h.copy('Shockwave');
      h.x = (n % 26) * -6;
      h.copy('Shockwave');
      h.animation = '';
      h.x = 0;
      h.ghost = (wave() * 100 + 50) / 2;
    }
  }
  if (h.phase(3, 20)) {
    h.ghost += 5;
    h.rotation += 1;
  }
  if (h.phase(4, 1)) h.remove();
}

function planet(f: Fighter, h: Hitbox): void {
  if (life(h) === 1) {
    h.ghost = 100;
    h.x = 0;
    h.y = 100;
    h.size = 300;
  }
  if (h.phase(1, 20)) {
    h.ghost -= 5;
    h.rotation -= 1;
  }
  if (h.phase(2, 1)) {
    for (const other of f.all()) {
      if (other.index !== f.index && (f.team === '' || other.team === '' || f.team !== other.team)) h.changeStats(other, { fallSpeed: ['*', 2] });
    }
  }
  if (h.phase(3, 300)) {
    h.behind = true;
    h.rotation -= 1;
    h.size += f.math.sin(Number(f.vars.Timer) * 100) * 1;
  }
  if (h.phase(4, 20)) {
    h.ghost += 5;
    h.rotation -= 1;
  }
  if (h.phase(5, 1)) h.remove();
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
        npunch(f, h);
        break;
      case 'RunPunch':
        if (h.phase(1, 1)) {
          h.ghost = 30;
          f.vx += h.direction === 90 ? -3 : 3;
        }
        h.phase(2, 3);
        if (h.phase(3, 1)) f.vx += h.direction === 90 ? 10 : -10;
        if (h.phase(4, 7)) {
          if (h.direction === 90 && f.buttons.right) f.vx += 1;
          if (h.direction === -90 && f.buttons.left) f.vx += -1;
        }
        h.phase(5, 3);
        if (h.phase(6, 1)) h.remove();
        break;
      case 'UpPunch':
        if (h.phase(1, 1)) {
          h.ghost = 30;
          f.vy = 5;
        }
        if (h.phase(2, 12)) steer(f, 0.5);
        if (h.phase(3, 1)) h.remove();
        break;
      case 'DownPunch':
        if (h.phase(1, 1)) {
          h.ghost = 100;
          h.follows = true;
          h.windowed = true;
        }
        h.phase(2, 3);
        if (h.phase(3, 5)) h.ghost -= 10;
        h.phase(4, 3);
        if (h.phase(5, 5)) h.ghost += 20;
        if (h.phase(6, 1)) h.remove();
        break;
      case 'DownAirPunch':
        downAir(f, h);
        break;
      case 'E1':
        sphere(f, h);
        break;
      case 'OrbBurst':
        still(h);
        if (h.phase(1, 20)) h.rotation += 120;
        if (h.phase(2, 1)) h.remove();
        break;
      case 'E3':
        shockpulse(f, h);
        break;
      case 'Shockwave':
        shockwave(h);
        break;
      case 'Rune':
        rune(f, h);
        break;
      case 'E5':
        pull(f, h);
        break;
      case 'Planet':
        planet(f, h);
        break;
    }
  },

  hit(fighter, target, hitbox) {
    // The orb bursts on its one hit, as it does on a wall or the ground.
    if (hitbox.name === 'E1' && Number(hitbox.attribute('hitsBeforeDeletion')) === 1) hitbox.copy('OrbBurst');
  },
} satisfies Gimmick;
