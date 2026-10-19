# Red Gnaw

![Red Gnaw's character select portrait](art/portrait/icvd8s4d-01.png)

Red Gnaw is Gnaw with red scales, gold spikes and angry eyebrows. He is quicker on his feet, falls faster, and takes more knockback, and several of his moves hit sooner, reach further or come out in a new shape. His hits deal Gnaw's damage. His fireball burns red, flies flatter and further, and pops targets up. Every hit adds a third of a Red stack to the target, shown as three diamonds over its head, and Red fades 3 seconds after the last hit. Three full stacks burst for 18% extra damage and paint the target red for 3 seconds.

This folder holds the finished character. The steps below make it from scratch in the mod maker.

## Make it yourself

1. Run `npm run characters` to open the mod maker, or choose **Mods** and then **Make a mod** on the game's page.
2. Choose **New character** (the person icon), name it Red Gnaw, and start from Gnaw.
3. On the **Overview** tab, write the story and the how-to-play text that the character select screen shows.
4. On the **Stats** tab, set Speed to 1.5, Friction to 0.72, Jump height to 10, Fall speed to 1.1, Air speed to 1.8 and Knockback taken to 1.4.
5. On the **Animations** tab, choose **Recolor character** (the palette icon). Tick the reds of the spikes, drag the hue to gold, and choose **Apply**.
6. Open **Recolor character** again and tick one green. Choose **Tick similar colors**, drag the hue to red, and choose **Apply**.
7. Choose **Paint** (the brush icon) on the idle row and add a layer. Draw a short dark line above the eye that slopes down toward the snout, and save.
8. Draw the eyebrows on the other animations the same way. Onion skin shows the neighboring frames, so the brows line up from frame to frame.
9. On the **Art** tab, paint thick brows over the eyes in the portrait, the roster icon and the match intro art, and repaint the name images.
10. On the **Moves** tab, set **Move data** to Customized for every move and raise its knockback a little.
11. Select UpPunch and drag its red **Can hit** bar to start at frame 2 and end at frame 8. Drag a corner of the red hitbox until it is tall and narrow, then drag the box up a little.
12. Select DownAirPunch and drag its **Can hit** bar to start at frame 5 and end at frame 13, so the spike comes out sooner. Select RunPunch and drag its bar to start at frame 4 and end at frame 12.
13. Select DownPunch and make the hitbox wide and flat. Select NPunch and drag the box further in front of Gnaw for more reach.
14. Select E3 (Big Bite), move the timeline to frame 8, and choose **Add a sound at the timeline frame** with the bite sound from `sounds/E3.wav`. The bite now chomps twice.
15. Under **Extra hitboxes** at the bottom of the move list, select Fireball, the fireball that E1 and E5 throw. Set **Move data** to Customized and raise Knockback Y to 18 so the fireball pops targets up.
16. Customize FireStationary, the fire the fireball leaves on the ground, and FireballImpact, the fireball's explosion, without changing their numbers.
17. Make the fire red in all three. Choose **Paint effect frames** (the brush icon) and fill the yellow, light orange, orange and deep orange with `#ff9a8a`, `#ff5a50`, `#e8242c` and `#96101c`, the colors of the Red marks. You can also choose **Export effect**, change the colors in another image editor, and bring the frames back with **Import effect**.
18. On the **Particles** tab, choose **New particle**, name it `red1`, and paint three small diamonds with the first one a third full. Make `red2` to `red9` the same way, each a third fuller than the one before.
19. On the **Overview** tab, choose **Add a gimmick script**. Replace the contents of the new `gimmick.ts` with this folder's `gimmick.ts`. Besides the Red marks, its `move` function throws fireballs flatter and faster than Gnaw's.
20. Choose **Build and play** (the play icon) and pick Red Gnaw on the character select screen.

Hover over any button to see its name.

## Add it to the game as a mod

1. In the mod maker, pick Red Gnaw under Examples and choose **Export character** in the top bar to download `red-gnaw.sfrt`.
2. On the game's page, choose **Mods** in the top-left corner of the main menu, then **Add mod**, and pick `red-gnaw.sfrt`.
3. The game asks whether to turn on Red Gnaw's script. Choose **Turn script on**, or his Red marks and burst do not happen.
4. Choose **Reload to apply**. Red Gnaw stays on the character select screen in this browser.

The Mods screen also turns a mod off and on, and deletes it. Anyone can add the `.sfrt` file the same way, on the published site too.

## Play it online

Two players meet online only when they run the same game with the same mods turned on. A player with different mods gets "That room runs a different version of the game" instead of a game that drifts apart.

1. Every player adds the same `.sfrt` files on the Mods screen and turns on the same ones.
2. One player hosts a game and shares the room code, and the others join as usual.

## Other ways to add it

- In the mod maker, choose **New character**, pick Red Gnaw under Examples, and choose **Build and play**. This builds it into your copy of the game.
- Without the mod maker, copy this folder to `characters/red-gnaw` and run `npm run characters:build`.
- To put it on a site for everyone, fork the repository, copy the folder into `characters/`, and push. The site workflow builds every character in `characters/` into the published game. The public room server accepts only the original site and local pages, so a fork needs its own room server from `server/` with its site's address in `ALLOWED_ORIGINS` and the `RELAY_URL` repository variable set to it. The README's publishing section has the steps.
