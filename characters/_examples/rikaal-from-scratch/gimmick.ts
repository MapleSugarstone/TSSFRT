import type { Fighter, Gimmick, Hitbox } from '@characters/api';

// Rikaal's moves, made with the mod maker alone. Every move is this character's own data on the Moves tab,
// and this script does what Rikaal's built-in move scripts do, phase by phase. His heavy landing comes
// from Rikaal's movement rules, chosen on the Overview tab, and the entries named after the actions the
// script switches him to (RunThrow, Ebreak, land and the others) give those actions Rikaal's flags.
// `life` counts a hitbox's frames from 1, as Rikaal's scripts do.
//
// Gimmick slots 1 and 5 belong to the movement rules: 1 is the heavy landing and 5 lets UpPunch launch
// higher once per landing. Hitbox slot 1 is E1's aim (1 for up), DownAirPunch's landing, and the beam's
// turn speed. Slot 2 is which way up turns the beam, slot 3 the beam's direction, and slot 4 the throw.

const life = (h: Hitbox) => h.frame + 1;

/** Move attributes by their number in the game's move data (1 is hitbox width, 7 knockback X, and on). */
const FIELDS = ['hitboxWidth', 'hitboxHeight', 'displacementX', 'displacementY', 'pushbackX', 'pushbackY', 'knockbackX', 'knockbackY', 'iframes', 'hitstun', 'damage', 'hitsBeforeDeletion', 'rotateStyle', 'comboGain', 'knockbackScalingX', 'knockbackScalingY', 'hitstunScaling', 'diScaling', 'cloneType'] as const;
function attrs(h: Hitbox, values: Record<number, number>): void {
  for (const [i, v] of Object.entries(values)) h.setAttribute(FIELDS[Number(i) - 1], v);
}

/** The fighter's facing as 1 or -1. */
const ahead = (f: Fighter) => f.direction / 90;

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

function taunt(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 28)) h.active = false;
  if (h.phase(2, 1)) {
    f.drawOffsetX += 4;
    f.shakeCamera(8, 2);
  }
  if (h.phase(3, 12)) f.drawOffsetX += life(h) % 2 === 0 ? -8 : 8;
  if (h.phase(4, 1)) {
    f.drawOffsetX -= 4;
    h.remove();
  }
}

/** RunPunch grabs, and a grabbed fighter is lifted, slammed behind and thrown. */
function runPunch(f: Fighter, h: Hitbox): void {
  h.grabs = true;
  h.active = false;
  h.phase(1, 7);
  if (h.phase(2, 1)) f.vx = 8 * ahead(f);
  if (h.phase(3, 7)) {
    h.active = true;
    if (h.holding) {
      h.active = false;
      f.switchTo('RunThrow');
      h.playSound('tough grab');
      h.holdAt(20, 30, 0);
      h.endPhase(3);
    }
    if (!h.holding && h.phaseLeft(3) < 2) return h.remove();
  }
  if (!h.holding) return;
  if (h.phase(4, 10)) f.vy = 1;
  if (h.phase(5, 1)) {
    h.playSound('runthrow7');
    h.particle('02_Expl', -10, -10);
  }
  if (h.phase(6, 2)) {
    h.holdAt(-20, 30, 0);
    f.vy = 1;
  }
  if (h.phase(7, 3)) {
    h.holdAt(20, 3, 0);
    f.vy = 1;
  }
  if (h.phase(8, 2)) {
    h.release();
    h.grabs = false;
    h.active = true;
  }
  if (h.phase(9, 1)) h.remove();
}

/** DownAirPunch hops, then dives, and slides along the ground if it lands. */
function downAir(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) {
    h.active = false;
    f.vy = 5;
  }
  h.phase(2, 7);
  if (h.phase(3, 1)) {
    h.setSlot(1, 0);
    f.vy = -20;
  }
  if (h.phase(4, 11)) {
    f.vx = 15 * ahead(f);
    h.moveSteps(0, 0);
    h.active = true;
    if (h.hitWall || h.hitGround) {
      f.jumps = 0;
      f.setSlot(5, 0);
      f.setSlot(1, 0);
      h.setSlot(1, 1);
      attrs(h, { 1: 75, 2: 15 });
      h.offsetY = -5;
      h.endPhase(4);
    }
  }
  if (h.phase(5, 3)) {
    if (h.slot(1) === 1) {
      f.vx = 5 * ahead(f);
      f.switchTo('downslide');
      h.playSound('k4_se_st3_rock_land_00_Ba');
      f.setSlot(5, 0);
      f.setSlot(1, 0);
      f.shakeCamera(5, 2.5);
    } else {
      h.active = false;
      f.switchTo('idle');
      f.vy = f.vy - 2.5;
      f.vx = 10 * ahead(f);
    }
  }
  if (h.phase(6, 1)) {
    f.setSlot(5, 0);
    f.setSlot(1, 0);
    h.remove();
  }
}

/** UpPunch launches straight up, higher on the first one after touching the ground. */
function upPunch(f: Fighter, h: Hitbox): void {
  const boost = () => f.slot(5) === 1;
  if (h.phase(1, 4)) h.active = false;
  if (h.phase(2, 13)) {
    if (boost()) {
      h.setAttribute('knockbackY', f.vy + 4);
      f.vy = 6;
      h.offsetY += 1;
    } else h.setAttribute('knockbackY', f.vy);
    h.active = true;
  }
  if (h.phase(3, 5)) h.active = false;
  if (h.phase(4, 1)) h.offsetY += 5;
  if (h.phase(5, 4)) {
    if (boost()) f.vy = 8;
    attrs(h, { 8: 12, 16: 12, 6: -4, 18: 6 });
    h.active = true;
  }
  if (h.phase(6, 1)) {
    f.setSlot(5, 0);
    h.remove();
  }
}

/** E1, Vice Grip: a lunge forward or upward that grabs, then a throw chosen by the direction held. */
function viceGrip(f: Fighter, h: Hitbox): void {
  const grabbed = () => {
    if (h.holding) for (const n of [5, 6, 7]) h.endPhase(n);
  };
  if (h.phase(1, 1)) {
    h.active = false;
    h.armor = true;
    h.setSlot(1, 0);
    if (f.jumps < 2) f.jumps = 2;
  }
  if (h.phase(2, 1) && f.buttons.up) h.setSlot(1, 1);
  if (h.phaseLeft(2) >= 1) return;
  if (h.slot(1) === 1) {
    if (h.phase(3, 1)) {
      h.offsetX = 10;
      h.offsetY = 10;
      attrs(h, { 1: 30, 2: 45 });
      f.switchTo('UpE');
      h.playSound('E1-7-n');
    }
    if (h.phase(4, 4)) {
      f.vy = 0;
      f.vx = 0;
    }
    if (h.phase(5, 3)) {
      h.playSound('asa_thrus_03');
      h.grabs = true;
      h.active = true;
      f.vx = 20 * ahead(f);
      f.vy = 30;
      grabbed();
    }
    if (h.phase(6, 4)) {
      f.vx = 3 * ahead(f);
      f.vy = 5;
      grabbed();
    }
    if (h.phase(7, 3)) {
      f.vy = 1;
      f.vx = 1 * ahead(f);
      grabbed();
    }
  } else {
    if (h.phase(3, 4)) {
      if (h.phaseLeft(3) === 2) h.playSound('E1-7-n');
      if (h.phaseLeft(3) === 1) {
        h.playSound('asa_thrus_03');
        f.vx = -20 * ahead(f);
      }
    }
    if (h.phase(4, 4)) {
      f.vx = f.vx + 8 * ahead(f);
      f.vy = 1;
    }
    if (h.phase(5, 3)) {
      h.grabs = true;
      h.active = true;
      f.vx = 18 * ahead(f);
      f.vy = 1;
      grabbed();
    }
    if (h.phase(6, 3)) {
      f.vx = 16 * ahead(f);
      f.vy = 1;
      grabbed();
    }
    if (h.phase(7, 3)) {
      f.vx = f.vx + -1 * ahead(f);
      f.vy = 1;
      grabbed();
    }
  }
  if (h.phaseLeft(7) >= 1) return;
  h.armor = false;
  if (h.holding) return throwGrabbed(f, h);
  if (h.phase(8, 4)) {
    h.active = false;
    if (h.slot(1) === 1) {
      f.vy = 0;
      f.vx = 1 * ahead(f);
    } else f.vy = 1;
  }
  if (h.phase(9, 4)) h.remove();
}

const DOWN = 1;
const UP = 2;
const BACK = 3;
const FORWARD = 4;

/** Knockback of each throw, by attribute number. */
const THROWS: Record<number, Record<number, number>> = {
  [DOWN]: { 9: 2, 7: 6, 8: -20, 11: 8, 10: 20, 15: 0, 16: 0, 17: 0, 18: 10 },
  [BACK]: { 9: 2, 7: 20, 8: 10, 10: 9, 11: 8, 14: 20, 15: 22, 16: 10, 17: 10, 18: 4 },
  [FORWARD]: { 9: 2, 7: 17, 8: 9, 10: 8, 11: 23, 14: 20, 15: 23, 16: 7, 17: 7, 18: 5 },
  [UP]: { 9: 2, 7: 0, 8: 11, 10: 13, 11: 5, 15: 0, 16: 19, 17: 14, 18: 10 },
};

function throwGrabbed(f: Fighter, h: Hitbox): void {
  if (h.phase(8, 2)) {
    h.active = false;
    h.armor = true;
    f.switchTo('Ebreak');
    h.holdAt(10, 10, 0);
    h.offsetX = 0;
    h.offsetY = 7;
    attrs(h, { 1: 60, 2: 60 });
    h.playSound('tough grab');
  }
  if (h.phase(9, 7)) {
    f.vy = 1;
    f.vx = 0;
    const b = f.buttons;
    h.setSlot(4, b.down ? DOWN : b.up ? UP : (b.left && f.direction === 90) || (b.right && f.direction === -90) ? BACK : FORWARD);
  }
  if (h.phaseLeft(9) >= 1) return;
  const kind = h.slot(4);
  if (kind === DOWN) backBreaker(f, h);
  else if (kind === UP) upThrow(f, h);
  else if (kind === BACK) backThrow(f, h);
  else forwardThrow(f, h);
}

function backBreaker(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    h.windowed = true;
    attrs(h, THROWS[DOWN]);
    f.vy = 10;
  }
  if (h.phase(11, 2)) {
    h.setSlot(2, 0);
    h.setSlot(3, Number(f.buttons.right) - Number(f.buttons.left));
    f.vy = 25;
    h.playSound('POT_Entry_005');
  }
  if (h.phase(12, 100)) {
    f.vy = -5 < f.vy && f.vy < 1 ? f.vy - 0.05 : f.vy - 4;
    h.holdAt(0, 30, 0);
    h.moveSteps(0, 0, true, f.vy > 1);
    if (f.vy < -25) f.vy = -25;
    f.vx = h.slot(3) * 6;
    if (h.hitWall || h.hitGround) h.endPhase(12);
  }
  if (h.phase(13, 1)) {
    f.vx = 0;
    f.vy = 0;
    f.switchTo('BreakThrow');
  }
  if (h.phase(14, 2)) {
    h.release();
    h.grabs = false;
    h.windowed = false;
    h.active = true;
  }
  if (h.phase(15, 3)) f.vy = 0;
  if (h.phase(16, 1)) h.remove();
}

function upThrow(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    f.switchTo('UpThrow');
    attrs(h, THROWS[UP]);
    h.active = false;
  }
  if (h.phase(11, 4)) h.holdAt(15, 0, 0);
  if (h.phase(12, 4)) h.holdAt(10, -20, 0);
  if (h.phase(13, 2)) h.holdAt(0, 20, 0);
  if (h.phase(14, 2)) {
    h.release();
    h.grabs = false;
    h.active = true;
  }
  if (h.phase(15, 1)) h.remove();
}

function backThrow(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    f.switchTo('DownThrow');
    attrs(h, THROWS[BACK]);
    f.direction = 0 - f.direction;
    h.active = false;
    h.holdAt(0, -10, 0);
  }
  if (h.phase(11, 3)) {
    f.vy = 1;
    f.vx = 0;
  }
  if (h.phase(12, 1)) {
    h.playSound('downthrow7');
    f.vy = 10;
  }
  if (h.phase(13, 1)) f.vx = 15 * ahead(f);
  if (h.phase(14, 12)) h.holdAt(0, -10, 0);
  if (h.phase(15, 1)) {
    attrs(h, { 3: 30, 4: 0 });
    h.release();
    h.grabs = false;
    h.active = true;
  }
  h.phase(16, 2);
  if (h.phase(17, 1)) h.remove();
}

function forwardThrow(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    f.switchTo('Fthrow');
    attrs(h, THROWS[FORWARD]);
    h.release();
    h.grabs = false;
    h.active = true;
  }
  h.phase(11, 3);
  if (h.phase(12, 1)) h.remove();
}

/** Copies a beam hitbox along a direction from the fighter, ten times, as Rikaal's beam does. */
function beam(f: Fighter, h: Hitbox, name: string, steer: boolean): void {
  const dir = h.slot(3);
  const [sin, cos] = [f.math.sin(dir), f.math.cos(dir)];
  h.hidden = false;
  h.armor = false;
  const [x, y] = [f.x, f.y];
  h.x = h.x + sin * 15;
  h.y = h.y + cos * 15;
  for (let i = 0; i < 10; i++) {
    h.x = h.x + sin * 40;
    h.y = h.y + cos * 40;
    h.copy(name);
  }
  h.x = x;
  h.y = y;
  h.rotation = h.slot(3);
  if (steer) {
    // Up and down turn the beam, up always toward the sky.
    let turn = h.slot(1) * 0.2;
    const sign = h.slot(2) === 1 ? 1 : -1;
    if (f.buttons.up) turn += sign;
    if (f.buttons.down) turn -= sign;
    h.setSlot(1, turn);
    h.setSlot(3, h.slot(3) + turn);
  }
  h.armor = true;
  h.hidden = true;
}

/** E5, Absolution: a red beam aimed with up and down, then fired, pushing Rikaal back. */
function absolution(f: Fighter, h: Hitbox): void {
  if (h.phase(1, 1)) {
    h.armor = true;
    h.active = false;
    h.playSound('Collapse1');
    h.setSlot(2, f.direction / -90);
    h.setSlot(3, f.direction);
    h.setSlot(1, 0);
  }
  if (h.phase(2, 25)) {
    f.vy = 1;
    beam(f, h, 'BeamShadow', true);
  }
  if (h.phase(3, 1)) {
    h.playSound('se_demon_final02_02');
    h.playSound('s99_electric');
    f.shakeCamera(6, 3);
  }
  if (h.phase(4, 15)) {
    f.vx = f.math.sin(h.slot(3)) * -3;
    f.vy = f.math.cos(h.slot(3)) * -3;
    beam(f, h, 'Beam', false);
  }
  if (h.phase(5, 1)) h.remove();
}

/** One segment of the beam: it hits away from Rikaal along the beam's direction. */
function beamSegment(f: Fighter, h: Hitbox): void {
  const dir = h.slot(3);
  const [sin, cos] = [f.math.sin(dir), f.math.cos(dir)];
  if (h.phase(1, 2)) {
    h.armor = true;
    h.active = true;
    h.windowed = false;
    h.noHitPause = true;
    h.direction = 90;
    h.rotation = dir;
    attrs(h, { 7: sin * 2, 8: cos * 2 + 1, 15: sin * 5, 16: cos * 5 });
  }
  if (h.phase(2, 2)) {
    h.noHitPause = false;
    attrs(h, { 7: sin * 30 + 5, 8: cos * 30 + 5, 10: 10, 11: 20, 15: sin * 100, 16: cos * 100 });
  }
  if (h.phase(3, 1)) h.remove();
}

export default {
  tick(f, h) {
    switch (h.name) {
      case 'Taunt':
        taunt(f, h);
        break;
      case 'Dodge':
        dodge(f, h);
        break;
      case 'NPunch':
        if (h.charge()) break;
        if (life(h) === h.slot(1)) {
          h.ghost = 30;
          h.playSound('k4_se_damage_flame_00_Ba');
        }
        h.phase(1, 6);
        if (h.phase(2, 1)) h.remove();
        break;
      case 'DownPunch':
        if (h.charge()) break;
        h.phase(1, 6);
        if (h.phase(2, 1)) {
          f.shakeCamera(5, 3);
          h.playSound('k4_se_st3_rock_land_00_Ba');
          h.playSound('crumble');
        }
        h.phase(3, 10);
        if (h.phase(4, 1)) h.remove();
        break;
      case 'RunPunch':
        runPunch(f, h);
        break;
      case 'DownAirPunch':
        downAir(f, h);
        break;
      case 'UpPunch':
        upPunch(f, h);
        break;
      case 'E1':
        viceGrip(f, h);
        break;
      case 'E3':
        // Primal Roar: hidden while it builds, then a roar that shakes the screen.
        if (h.phase(1, 10)) {
          h.armor = true;
          h.hidden = true;
          f.vy = 1;
        }
        if (h.phase(2, 1)) {
          h.hidden = false;
          h.playSound('burst7');
          f.shakeCamera(20, 5);
        }
        if (h.phase(3, 25)) {
          if (f.buttons.right) f.vx += 1;
          if (f.buttons.left) f.vx -= 1;
          if (!f.buttons.down) f.vy = 2;
        }
        if (h.phase(4, 1)) {
          h.armor = false;
          h.remove();
        }
        break;
      case 'E5':
        absolution(f, h);
        break;
      case 'Beam':
        beamSegment(f, h);
        break;
      case 'BeamShadow':
        if (h.phase(1, 2)) {
          h.rotation = h.slot(3);
          h.active = false;
          h.follows = false;
        }
        if (h.phase(2, 1)) h.remove();
        break;
    }
  },
} satisfies Gimmick;
