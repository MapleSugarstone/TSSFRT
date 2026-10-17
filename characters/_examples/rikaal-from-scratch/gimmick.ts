import type { Fighter, Gimmick, Hitbox, MoveAttribute } from '@characters/api';

// Rikaal From Scratch: every move is this character's own data on the Moves tab, and this script moves the
// hitboxes the way Rikaal's move scripts do. His heavy landing is not here: it comes from Rikaal's built-in
// rules, chosen on the Overview tab. The Moves tab also has entries named after the actions this script
// switches him to (RunThrow, Ebreak, land and the others), which give those actions Rikaal's flags.
//
// How to read it: `tick` runs every frame for each hitbox, and the switch at the bottom picks the move by
// name. Most moves run in phases: `h.phase(1, 4)` is true for the hitbox's first 4 frames, `h.phase(2, 13)`
// for the 13 after those, and so on. As in the original scripts, a phase starts on the last frame of the one
// before it. `h.endPhase(n)` ends a phase early, such as when a grab connects.
//
// Rikaal's built-in rules use gimmick slots 1 and 5: slot 5 is 1 once he has touched the ground, which
// lets UpPunch launch higher.

const life = (h: Hitbox) => h.frame + 1;
/** The fighter's facing as 1 (right) or -1 (left). */
const ahead = (f: Fighter) => f.direction / 90;

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

/** Taunt: Rikaal stomps, shaking himself and the camera. */
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

/** RunPunch: a grab, and a fighter it catches is lifted, slammed behind and thrown. */
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

/** DownAirPunch: a hop, then a dive that becomes a slide along the ground if it lands. */
function downAir(f: Fighter, h: Hitbox): void {
  // Slot 1 is 1 once the dive has landed.
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
      set(h, { hitboxWidth: 75, hitboxHeight: 15 });
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

/** UpPunch: a launch straight up, higher on the first one after touching the ground. */
function upPunch(f: Fighter, h: Hitbox): void {
  const boosted = () => f.slot(5) === 1;
  if (h.phase(1, 4)) h.active = false;
  if (h.phase(2, 13)) {
    if (boosted()) {
      h.setAttribute('knockbackY', f.vy + 4);
      f.vy = 6;
      h.offsetY += 1;
    } else h.setAttribute('knockbackY', f.vy);
    h.active = true;
  }
  if (h.phase(3, 5)) h.active = false;
  if (h.phase(4, 1)) h.offsetY += 5;
  if (h.phase(5, 4)) {
    if (boosted()) f.vy = 8;
    set(h, { knockbackY: 12, knockbackScalingY: 12, pushbackY: -4, diScaling: 6 });
    h.active = true;
  }
  if (h.phase(6, 1)) {
    f.setSlot(5, 0);
    h.remove();
  }
}

/** E1, Vice Grip: a lunge forward, or upward with up held, that grabs. A grabbed fighter is thrown by the direction held. */
function viceGrip(f: Fighter, h: Hitbox): void {
  // Slot 1 is "up" or "side", the way it lunges. A grab ends the lunge's phases early.
  const grabbed = () => {
    if (h.holding) for (const n of [5, 6, 7]) h.endPhase(n);
  };
  if (h.phase(1, 1)) {
    h.active = false;
    h.armor = true;
    h.setSlot(1, 'side');
    if (f.jumps < 2) f.jumps = 2;
  }
  if (h.phase(2, 1) && f.buttons.up) h.setSlot(1, 'up');
  if (h.phaseLeft(2) >= 1) return;
  if (h.slotText(1) === 'up') {
    if (h.phase(3, 1)) {
      h.offsetX = 10;
      h.offsetY = 10;
      set(h, { hitboxWidth: 30, hitboxHeight: 45 });
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
    if (h.slotText(1) === 'up') {
      f.vy = 0;
      f.vx = 1 * ahead(f);
    } else f.vy = 1;
  }
  if (h.phase(9, 4)) h.remove();
}

/** How hard each throw hits. */
const THROWS: Record<string, Partial<Record<MoveAttribute, number>>> = {
  down: { iframes: 2, knockbackX: 6, knockbackY: -20, damage: 8, hitstun: 20, knockbackScalingX: 0, knockbackScalingY: 0, hitstunScaling: 0, diScaling: 10 },
  up: { iframes: 2, knockbackX: 0, knockbackY: 11, hitstun: 13, damage: 5, knockbackScalingX: 0, knockbackScalingY: 19, hitstunScaling: 14, diScaling: 10 },
  back: { iframes: 2, knockbackX: 20, knockbackY: 10, hitstun: 9, damage: 8, comboGain: 20, knockbackScalingX: 22, knockbackScalingY: 10, hitstunScaling: 10, diScaling: 4 },
  forward: { iframes: 2, knockbackX: 17, knockbackY: 9, hitstun: 8, damage: 23, comboGain: 20, knockbackScalingX: 23, knockbackScalingY: 7, hitstunScaling: 7, diScaling: 5 },
};

/** Holds the grabbed fighter for a moment, then throws it by the direction held: slot 4 keeps which. */
function throwGrabbed(f: Fighter, h: Hitbox): void {
  if (h.phase(8, 2)) {
    h.active = false;
    h.armor = true;
    f.switchTo('Ebreak');
    h.holdAt(10, 10, 0);
    h.offsetX = 0;
    h.offsetY = 7;
    set(h, { hitboxWidth: 60, hitboxHeight: 60 });
    h.playSound('tough grab');
  }
  if (h.phase(9, 7)) {
    f.vy = 1;
    f.vx = 0;
    const b = f.buttons;
    const back = (b.left && f.direction === 90) || (b.right && f.direction === -90);
    h.setSlot(4, b.down ? 'down' : b.up ? 'up' : back ? 'back' : 'forward');
  }
  if (h.phaseLeft(9) >= 1) return;
  const kind = h.slotText(4);
  if (kind === 'down') backBreaker(f, h);
  else if (kind === 'up') upThrow(f, h);
  else if (kind === 'back') backThrow(f, h);
  else forwardThrow(f, h);
}

/** The down throw: Rikaal leaps with the fighter, steered left or right, and slams down. */
function backBreaker(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    h.windowed = true;
    set(h, THROWS.down);
    f.vy = 10;
  }
  if (h.phase(11, 2)) {
    // Slot 3 is the way the leap is steered: 1, -1 or 0.
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
    set(h, THROWS.up);
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

/** The back throw: Rikaal turns around, jumps, and throws the fighter the other way. */
function backThrow(f: Fighter, h: Hitbox): void {
  if (h.phase(10, 1)) {
    f.switchTo('DownThrow');
    set(h, THROWS.back);
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
    set(h, { displacementX: 30, displacementY: 0 });
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
    set(h, THROWS.forward);
    h.release();
    h.grabs = false;
    h.active = true;
  }
  h.phase(11, 3);
  if (h.phase(12, 1)) h.remove();
}

/**
 * Draws Rikaal's beam: ten copies of a hitbox in a line from him along slot 3's direction. While aiming,
 * up and down turn it, up always toward the sky. Slot 1 is how fast it turns and slot 2 which way is up.
 */
function beam(f: Fighter, h: Hitbox, name: string, aiming: boolean): void {
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
  if (aiming) {
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

/** E5, Absolution: a shadow of the beam to aim with up and down, then the beam itself, pushing Rikaal back. */
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

/** One piece of the beam. It knocks away from Rikaal along the beam's direction, which it got from slot 3. */
function beamPiece(f: Fighter, h: Hitbox): void {
  const dir = h.slot(3);
  const [sin, cos] = [f.math.sin(dir), f.math.cos(dir)];
  if (h.phase(1, 2)) {
    h.armor = true;
    h.active = true;
    h.windowed = false;
    h.noHitPause = true;
    h.direction = 90;
    h.rotation = dir;
    set(h, { knockbackX: sin * 2, knockbackY: cos * 2 + 1, knockbackScalingX: sin * 5, knockbackScalingY: cos * 5 });
  }
  if (h.phase(2, 2)) {
    h.noHitPause = false;
    set(h, { knockbackX: sin * 30 + 5, knockbackY: cos * 30 + 5, hitstun: 10, damage: 20, knockbackScalingX: sin * 100, knockbackScalingY: cos * 100 });
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
        // charge() keeps the frame attack was let go on in slot 1.
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
        // Primal Roar: hidden with super armor while it builds, then a roar that shakes the screen.
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
        beamPiece(f, h);
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
