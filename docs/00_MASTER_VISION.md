# Bite-Sized Golf - Master Vision and Development Prompt

I want you to stop thinking of this as a series of isolated coding tasks.

I want you to act as the Creative Director, Lead Gameplay Designer, Technical Director, and Senior Graphics Engineer for this project.

Your job is not simply to complete the next request.

Your job is to turn this into a polished commercial-quality mobile golf game.

Whenever there are multiple implementation options, choose the one that moves the game toward this vision.

---

# THE VISION

Johnson's Golf should feel like a modern mobile version of EA Sports Tiger Woods mixed with Hot Shots Golf (Everybody's Golf).

It should NOT feel like Mario Golf.

The target experience is:

* beautiful
* polished
* satisfying
* rewarding
* strategic
* easy to learn
* difficult to master

Every shot should require thought.

Every birdie should feel earned.

Every mistake should feel like it was the player's fault.

The player should never feel the game is helping them.

---

# GRAPHICS

This is now the highest priority.

The current game still looks like placeholder geometry.

Move away from flat colored polygons.

I want something that feels like a real modern video game.

Think:

• textured terrain

• lush grass

• realistic fairway transitions

• detailed bunkers

• believable trees

• shadows

• lighting

• depth

• elevation

• atmospheric perspective

• better water

• richer colors

• subtle shaders

• higher quality camera work

The Road Hole especially should become instantly recognizable.

The hotel/building should look like an actual building.

The road should feel like pavement.

The wall should have texture.

The course should feel alive.

Phaser is capable of much better visuals than we're currently using.

Take advantage of it.

---

# CAMERA

The camera should make every shot feel exciting.

Behind-the-player view during setup.

Ball-follow camera during flight.

Dynamic zoom.

Smooth transitions.

Aerial planning view.

Shots should have weight.

The camera should help sell distance.

---

# GAMEPLAY PHILOSOPHY

This game should be simple.

It should NOT be brainless.

The player should constantly make decisions.

Examples:

* club selection matters
* wind matters
* aim matters
* landing area matters
* trajectory matters
* spin matters
* lie matters
* green slope matters

If a player ignores those things they should score worse.

Good players should consistently beat average players.

---

# SWING SYSTEM

The swing meter should reward precision.

Currently it is far too forgiving.

Fix this.

The perfect window should only reward genuinely good timing.

Do not secretly help the player.

Remove any accidental double-perfect zones or cursor behaviors that make perfect timing easier.

Misses should have meaningful consequences.

Accuracy should noticeably affect dispersion.

Power mistakes should noticeably affect distance.

---

# PUTTING

Putting currently requires almost no thought.

Fix this completely.

I want:

* more detailed green grid
* stronger break
* more realistic speed
* meaningful aim
* realistic misses

The player should need to read greens.

Not every putt should go in.

Long putts should be difficult.

---

# PHYSICS

Physics should be believable.

Examples:

Balls should not travel through buildings.

Balls should bounce correctly.

Trees should block shots.

Buildings should block shots.

Roads should bounce differently than grass.

Bunkers should slow the ball.

Spin should matter.

Roll should matter.

Lie should matter.

Trajectory should matter.

The Road Hole building bug should be fixed completely.

---

# PLAYER ATTRIBUTES

Attributes should create meaningful differences.

Currently players feel too similar.

Increase the spread dramatically.

Power should vary approximately from 250 to 320 yards.

Current examples like 297 vs 284 are not enough.

Accuracy should directly affect shot dispersion and perfect zone size.

Approach should directly affect iron precision and perfect zone size.

Chipping should directly affect chip precision and perfect zone size.

Putting should directly affect putting perfect zone size and read forgiveness.

Each golfer should have a real identity.

Target overall ratings:

Adults: 87

Kids: 88

Keep these identities:

Jeff:

* shortest hitter
* elite accuracy
* elite short game

Matt:

* longest hitter
* strongest approach game
* weaker putting/chipping

Zac:

* longest hitter
* best chipping
* less accurate

Players should feel different immediately.

---

# SPIN SYSTEM

Allow the player to choose strike location on the golf ball before the shot using a small ball graphic in the HUD.

Examples:

Hit high.

Hit low.

Hit left.

Hit right.

These should affect launch angle, spin and curvature.

While the ball is in flight, switch to a cinematic ball-follow camera.

Allow swipe gestures to add spin.

Swipe left = left spin.

Swipe right = right spin.

Swipe down = backspin.

Swipe up = topspin.

Spin should influence both flight and rollout.

Higher lofted clubs should produce greater spin effects.

---

# ACCOUNT SYSTEM

Guests should be able to play immediately.

Accounts are optional.

Accounts unlock progression.

Accounts should save:

* coins
* cosmetics
* club upgrades
* unlocked items
* tournament history
* appearance

Everything should sync to the account.

---

# J-COINS

Reward:

20 coins per completed round.

+10 coins for every stroke under par.

---

# STORE

Add a Store/Market tab on the main menu.

Only available for logged-in players.

Organize by category.

Categories:

Golf Balls

Shirts

Dresses

Shoes

Hats

Club Upgrades

Starting cosmetics include:

Colored golf balls (yellow, blue, red)

Multiple shirt colors

Charmander shirt

Chicago Bulls shirt

Baseball shirt

Three dress colors

White Air Force-style shoes

Brown classic golf shoes

White classic golf shoes

Poké Ball inspired hat

Top hat

Bucket hat

Puma-inspired floral hat

Club upgrades:

Driver +3 Power

Irons +3 Approach

Wedges +3 Chipping

Putter +3 Putting

When equipped, upgraded clubs should appear gold in gameplay.

---

# TOURNAMENTS

Allow players to host tournaments.

Generate a shareable link.

Invite by text.

Each tournament has:

its own leaderboard

persistent scores

winner after everyone finishes

This should support friendly competitions.

---

# UI

Rename the title screen.

Remove "Amen Corner."

Use something like:

Three Hole Challenge

or another stronger title.

Menus should feel modern and polished.

---

# DEVELOPMENT PRIORITIES

Do NOT try to implement everything at once.

Instead work in this order:

1. Graphics overhaul
2. Gameplay balance
3. Physics improvements
4. Camera improvements
5. Spin system
6. Player attribute redesign
7. Accounts
8. Store
9. Cosmetics
10. Club upgrades
11. Tournament system

After each major milestone:

* refactor
* remove dead code
* optimize
* test
* polish before moving on

Quality is more important than speed.

Do not leave placeholder implementations.

Whenever possible, choose solutions that scale well because this game will continue growing with more courses, more golfers, online features, cosmetics and additional game modes.

The end goal is a polished mobile golf game that feels much closer to EA Sports Tiger Woods or Hot Shots Golf than Mario Golf.
