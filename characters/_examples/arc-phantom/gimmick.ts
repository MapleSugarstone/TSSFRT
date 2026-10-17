import type { Fighter, Gimmick, Hitbox } from '@characters/api';

// Arc Phantom, made with the mod maker alone: Arc's NPunch, RunPunch, DownPunch, Taunt and E5 (Judgement),
// and Phantom's UpPunch, DownAirPunch, Dodge, E1 (Shadowflame Charge) and E3 (Shadow Trick). Every move is this
// character's own data on the Moves tab, and this script does what Arc's and Phantom's move scripts do.
// `life` counts a hitbox's frames from 1, as those scripts do, so the numbers below are the ones in them.
//
// Gimmick slots: 3 is the fighter Shadow Trick goes to, 4 the NPunch charge, and 5 the life frame NPunch
// was let go on.
const TRICK = 3;
const CHARGE = 4;
const RELEASE = 5;

const life = (h: Hitbox) => h.frame + 1;
const forward = (f: Fighter) => (f.direction < 0 ? -1 : 1);
type Attribute = Parameters<Hitbox['setAttribute']>[0];

/** Sets several move attributes at once. */
function attrs(h: Hitbox, values: Partial<Record<Attribute, number>>): void {
  for (const [k, v] of Object.entries(values)) h.setAttribute(k as Attribute, v as number);
}
const add = (h: Hitbox, name: Attribute, by: number) => h.setAttribute(name, Number(h.attribute(name)) + by);
const addRounded = (h: Hitbox, name: Attribute, by: number) => h.setAttribute(name, Math.round(Number(h.attribute(name)) + by));

/**
 * The phases of a move that run on a life frame, given each phase's length and the frame the first one may
 * start on. As in the original scripts, a phase starts on the last frame of the one before.
 */
function phases(L: number, lengths: number[], from = 1): number[] {
  const on: number[] = [];
  let start = from;
  lengths.forEach((n, i) => {
    if (L >= start && L <= start + n - 1) on.push(i + 1);
    start += n - 1;
  });
  return on;
}

/** Arc's NPunch charges while attack is held, up to 50 frames, growing with the charge, and swings when let go. */
function npunch(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.ghost = 100;
    h.paused = true;
    f.setSlot(CHARGE, 0);
    f.setSlot(RELEASE, 0);
  }
  let release = f.slot(RELEASE);
  if (!release && f.buttons.attack) {
    const c = f.slot(CHARGE);
    if (c < 50) {
      f.setSlot(CHARGE, c + 1);
      if (c + 1 === 50) h.playSound('Charged');
    }
    f.lists.C_Charging[f.index - 1] = f.slot(CHARGE);
  } else if (!release) {
    const c = f.slot(CHARGE);
    h.size += c * 2;
    add(h, 'hitboxWidth', c / 5);
    add(h, 'hitboxHeight', c / 5);
    add(h, 'knockbackX', c / 3.5);
    add(h, 'knockbackY', c / 3.5);
    addRounded(h, 'damage', c / 2);
    addRounded(h, 'comboGain', c);
    addRounded(h, 'knockbackScalingX', c / 2);
    addRounded(h, 'knockbackScalingY', c);
    addRounded(h, 'hitstunScaling', c);
    f.lists.C_Charging[f.index - 1] = 0;
    f.setSlot(CHARGE, 0);
    release = L;
    f.setSlot(RELEASE, L);
    h.paused = false;
    h.ghost = 0;
  }
  if (!release) return;
  if (L === release) {
    h.playSound('NPunch-3_Manual');
    h.ghost = 30;
  }
  if (L >= release + 12) h.remove();
}

/** A spike from Arc's DownPunch: one of four looks, set on the ground, fading in and out. */
function spike(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.ghost = 100;
    h.animation = ['SpikeA', 'SpikeB', 'SpikeC', 'SpikeD'][f.random(1, 4) - 1];
    h.y += 10;
    h.toGround(100);
    if (!h.hitWall && !h.hitGround) {
      h.remove();
      return;
    }
    h.y -= 9;
  }
  if (L <= 3) {
    h.ghost -= 33;
    h.y += 3;
    h.x += h.direction / 90;
  }
  if (L >= 8 && L <= 10) h.ghost += 33;
  if (L === 10) h.remove();
}

/** Arc's Judgement: catch, three pairs of slashes on the held fighter, and a last dash through them. */
function judgement(f: Fighter, h: Hitbox): void {
  const L = life(h);
  const dir = h.direction < 0 ? -1 : 1;
  const silhouette = (x: number, y: number) => f.particle('ArcC5Silhouette', x - f.x, y - f.y, 2);
  const slash = (state: string, x: number, y: number) => {
    h.playSound('hit9');
    h.release();
    h.active = true;
    silhouette(x, y);
    f.switchTo(state);
    h.playSound('ArcC5_Hit');
    f.vy = 5;
    h.grabs = false;
  };
  const wait = () => {
    h.grabs = true;
    f.vy = 1.2;
    f.vx = 0;
  };
  if (L === 1) {
    h.active = true;
    h.playSound('ArcC5-Catch');
    h.playSound('Holy');
    h.playSound('ArcC5_Echo');
  }
  const opening = phases(L, [8, 5, 15]);
  if (opening.includes(1)) {
    h.follows = true;
    // As in Arc's script: Judgement has no Can hit window, and turning the window on makes the game read another move's.
    h.windowed = true;
    h.grabs = true;
    f.vx = 0;
    f.vy = 1.2;
    f.invincibility = 5;
  }
  if (opening.includes(2)) {
    h.holdAt(20, 0);
    f.vy = 1.2;
  }
  if (L === 8 && h.holding) {
    h.active = false;
    h.playSound('ArcC5-Connect');
  }
  if (opening.includes(3)) {
    h.active = false;
    h.holdAt(20, 0);
    f.vy = 1.2;
  }
  if (L === 28) {
    if (!h.holding) {
      h.release();
      h.remove();
      return;
    }
    f.invincibility = 100;
    // Arc's script plays an animation that has no frames here, which hides the hitbox.
    h.animation = 'Hidden';
    silhouette(h.x - 30, h.y);
    h.setAttribute('displacementX', 0);
    h.offsetX -= 30;
    attrs(h, { hitboxWidth: 60, hitboxHeight: 60, pushbackX: 10, pushbackY: 10, knockbackX: 0, knockbackY: 8, iframes: 5, hitstun: 25, knockbackScalingX: 0, knockbackScalingY: 0, hitstunScaling: 0, diScaling: 0 });
    h.release();
    h.grabs = false;
    h.active = true;
    h.holdAt(30, 0);
    h.setAttribute('damage', 8);
  }
  if (L < 29) return;
  // Arc's phases 4 to 28: down slash, a pause, a wait, up slash, and so on, then the last slash.
  const lengths = [1, 5, 8, 1, 5, 8, 1, 5, 8, 1, 5, 8, 1, 5, 8, 1, 5, 8, 1, 10, 15, 1, 5, 2, 1];
  for (const p of phases(L, lengths, 29)) {
    const k = p + 3;
    if (k === 4 || k === 10 || k === 16) {
      h.x = f.x;
      h.y = f.y;
      slash('Dslsh', f.x, f.y);
    }
    else if (k === 7 || k === 13 || k === 19) slash('Uslsh', h.x + 10, h.y + 15);
    else if (k % 3 === 0 && k <= 21) wait();
    else if (k === 22) {
      h.grabs = true;
      h.holdAt(30, 0);
      h.active = true;
      h.playSound('ArcC5_Echo');
      h.setAttribute('damage', 13);
    } else if (k === 23 || k === 24) {
      f.switchTo('LastSlsh');
      f.vx = 0;
      f.vy = k === 23 ? 1.2 : 1;
    } else if (k === 25) {
      h.playSound('E1-3');
      silhouette(h.x - 5, h.y);
      attrs(h, { knockbackX: 35, knockbackY: 20, iframes: 4, hitstun: 15, knockbackScalingX: 25, knockbackScalingY: 15, hitstunScaling: 20 });
      h.animation = 'JudgementFinish';
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
    } else if (k === 26) {
      h.ghost += 10;
      f.vx *= 0.7;
      f.vy = 1.2;
    } else if (k === 27) {
      f.vx *= 0.5;
      f.vy = 1.2;
      h.ghost += 10;
    } else if (k === 28) {
      f.switchTo('idle');
      f.vy = 6;
      h.remove();
    }
  }
}

/** Phantom's Shadowflame Charge: a spinning shadowflame that explodes on a wall, the ground, or the attack button. */
function shadowflame(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.y += 4;
    h.size = 150;
    h.follows = false;
    if (f.buttons.up) {
      h.y -= 20;
      h.spawn('ShadowRing');
      h.spawn('ShadowBurst');
      f.vy = 12;
      h.remove();
      return;
    }
    h.vx = f.buttons.right || f.buttons.left ? 6 : 4;
    // Phantom's flame stays put on its first frame, and a move of 0 keeps the game from moving it by vx.
    h.moveBy(0, 0);
  }
  if (L >= 2 && L <= 202) {
    h.heading += h.direction / 2;
    h.rotation += h.direction / 2;
    // Phantom's flame moves 2 steps a frame along its spin when thrown with a direction held, else 4.
    h.moveSteps(h.vx === 6 ? 2 : 4, h.heading);
    if (f.buttons.attack || h.hitWall || h.hitGround) {
      h.spawn('ShadowRing');
      h.spawn('ShadowBurst');
      h.remove();
      return;
    }
    h.moveBy(h.vx, h.vy);
  }
  if (L >= 202) h.remove();
}

/** Phantom's Shadow Trick: an explosion where Phantom stands, then a jump to the nearest enemy, placed by the held direction. */
function trick(f: Fighter, h: Hitbox): void {
  const L = life(h);
  if (L === 1) {
    h.active = false;
    h.follows = false;
    f.invincibility = 20;
    f.setSlot(TRICK, h.closestEnemy()?.index ?? 0);
    h.spawn('ShadowRing');
    h.spawn('ShadowBurst');
    h.size = 400;
  }
  const enemy = f.all().find((x) => x.index === f.slot(TRICK));
  if (L <= 10) {
    f.vy = 2;
    if (enemy) {
      h.x = enemy.x;
      h.y = enemy.y;
    }
    h.rotation += 20;
    h.size -= 10;
  } else if (L === 11) {
    if (enemy) {
      h.x = enemy.x;
      h.y = enemy.y;
    }
    h.pointAt(f.x, f.y);
    if (f.buttons.down) h.moveSteps(-60, 180);
    else if (f.buttons.right) h.moveSteps(-40, 90);
    else if (f.buttons.left) h.moveSteps(40, 90);
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
  hit(fighter, target, hitbox) {
    // Phantom's shadowflame explodes on the fighter it hits.
    if (hitbox.name === 'E1') {
      hitbox.spawn('ShadowRing');
      hitbox.spawn('ShadowBurst');
    }
  },

  move(fighter, hitbox) {
    // Arc's second spike is turned to face straight up, so it pushes up rather than to a side.
    if (hitbox.name === 'SpikeBack') hitbox.direction = 0;
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
        if (L === 1) h.ghost = 30;
        if (L >= 7 && L <= 14) {
          if (f.buttons.right) f.vx += 1;
          if (f.buttons.left) f.vx -= 1;
        }
        if (L >= 15) h.remove();
        break;
      case 'DownPunch':
        if (L === 1) {
          h.ghost = 30;
          h.offsetX += 10;
          h.offsetY += 7;
        }
        if (L >= 10) {
          h.playSound('ArcSpikeCrumble');
          h.spawn('Spike', 15, 0);
          h.spawn('SpikeBack', -15, 0);
          h.remove();
        }
        break;
      case 'Spike':
      case 'SpikeBack':
        spike(f, h);
        break;
      case 'E5':
        judgement(f, h);
        break;
      case 'UpPunch':
        if (L <= 6) {
          h.offsetY += 2;
          h.rotation += 40;
        } else if (L <= 14) {
          if (L === 8) attrs(h, { knockbackX: 5, knockbackY: 10, iframes: 7, hitstun: 8, damage: 4, knockbackScalingX: 8, knockbackScalingY: 24, hitstunScaling: 11, diScaling: 3 });
          h.rotation += 40;
        }
        if (L >= 14) h.remove();
        break;
      case 'DownAirPunch':
        if (L === 1) {
          h.follows = false;
          h.toGround(40);
          f.vx = 0;
        }
        if (L >= 2 && L <= 12) {
          f.vy = -6;
          if (L === 7) attrs(h, { displacementY: -30, knockbackX: 9, knockbackY: 9, iframes: 7, hitstun: 12, damage: 4, knockbackScalingX: 16, knockbackScalingY: 10, hitstunScaling: 8, diScaling: 4 });
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
          add(h, 'hitboxWidth', 2);
          add(h, 'hitboxHeight', 2);
        }
        if (L >= 10) h.remove();
        break;
      case 'ShadowRing':
        if (L <= 10) {
          h.size += 5;
          h.rotation -= h.direction / 10;
        }
        if (L >= 10) h.remove();
        break;
    }
  },
} satisfies Gimmick;
