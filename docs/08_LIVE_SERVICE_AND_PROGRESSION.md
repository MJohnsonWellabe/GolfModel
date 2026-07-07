# 08_LIVE_SERVICE_AND_PROGRESSION.md

# Johnson's Golf
## Live Service, Progression & Online Systems
Version 1.0

---

# Purpose

This document defines the online infrastructure and long-term progression systems for Johnson's Golf.

The objective is to encourage players to return because they enjoy improving, collecting, and competing—not because of artificial timers or pay-to-win mechanics.

Every online system should support the core gameplay rather than distract from it.

Golf always comes first.

---

# Design Philosophy

Johnson's Golf is not intended to be a live service in the traditional mobile gaming sense.

There should be:

- No energy system
- No paywalls
- No forced advertisements
- No pay-to-win upgrades
- No loot boxes
- No gambling mechanics

Players should return because:

- They want to improve.
- They want to unlock cosmetics.
- They want to compete.
- They want to beat friends.
- They want to master the courses.

---

# Account Philosophy

Accounts are optional.

Every player should be able to:

Download the game.

Open the game.

Play immediately.

Guest Mode should always be the default experience.

Accounts simply unlock persistent progression.

---

# Authentication

Firebase Authentication will support:

Guest

Google

Email & Password

Apple Sign-In (future)

Additional providers may be added later.

Players may convert a Guest account into a permanent account without losing progress.

---

# Player Profile

Every account should contain:

Unique ID

Display Name

Creation Date

Last Login

Coins

XP

Player Level

Owned Cosmetics

Equipped Cosmetics

Club Upgrades

Career Statistics

Tournament History

Achievements

Settings

Cloud Save

All information should synchronize automatically.

---

# Cloud Saves

Guest Players

Stored locally.

Account Players

Stored in Firebase.

Cloud saves should synchronize automatically.

The player should never manually upload or download save data.

---

# Progression Philosophy

Players should always feel they are making progress.

Progress comes from:

Improving skill.

Unlocking cosmetics.

Increasing level.

Completing achievements.

Setting records.

Winning tournaments.

The game should never require grinding.

---

# Experience Points (XP)

Every completed round awards XP.

Suggested values:

Complete Round

100 XP

Birdie

+25 XP

Eagle

+75 XP

Hole-in-One

+250 XP

Tournament Win

+200 XP

Daily Challenge

+50 XP

XP increases player level only.

It never directly improves gameplay.

---

# Player Levels

Levels represent experience.

Higher levels unlock:

Cosmetics

Titles

Profile badges

Future content

Levels should never provide gameplay advantages.

---

# Coins (J-Coins)

J-Coins are earned through gameplay.

Suggested rewards:

Finish Round

20 Coins

Every Stroke Under Par

+10 Coins

Tournament Win

+50 Coins

Daily Challenge

+25 Coins

Weekly Challenge

+100 Coins

Players should never lose coins.

---

# Store Economy

Typical pricing:

Common Items

100 Coins

Rare Items

200 Coins

Special Items

300 Coins

Seasonal Items

400 Coins

Club Upgrades

300 Coins

Future premium cosmetics may have separate pricing if desired, but gameplay must remain fair.

---

# Cosmetics

Initial Categories:

Golf Balls

Shirts

Dresses

Shoes

Hats

Club Skins

Future:

Gloves

Golf Bags

Swing Trails

Victory Animations

Scorecard Themes

Profile Icons

Cosmetics never affect gameplay.

---

# Club Upgrades

Club upgrades provide small gameplay bonuses.

Driver

+3 Power

Irons

+3 Approach

Wedges

+3 Chipping

Putter

+3 Putting

Equipped upgraded clubs should appear gold during gameplay.

These bonuses should remain modest and should not overshadow golfer attributes or player skill.

---

# Daily Challenges

Daily challenges encourage regular play.

Examples:

Play one round.

Make one birdie.

Hit every fairway.

Make a putt over 20 feet.

Finish under par.

Rewards:

Coins

XP

Profile badges (future)

Challenges should be completed naturally during normal play.

---

# Weekly Challenges

Examples:

Finish five rounds.

Win a tournament.

Record five birdies.

Make one eagle.

Complete every course.

Weekly rewards should be more substantial than daily rewards.

---

# Achievements

Categories:

Scoring

Distance

Accuracy

Putting

Chipping

Tournaments

Progression

Exploration

Examples:

First Birdie

First Eagle

First Hole-in-One

100 Fairways Hit

50 Putts Made

Win First Tournament

Reach Level 10

Achievements reward:

Coins

XP

Profile recognition

---

# Career Statistics

Track lifetime statistics.

Examples:

Rounds Played

Wins

Birdies

Eagles

Hole-in-Ones

Pars

Bogeys

Fairways Hit

Greens in Regulation

Average Score

Average Putts

Longest Drive

Longest Putt

Chip-Ins

Sand Saves

Tournament Wins

Statistics should update automatically after every round.

---

# Personal Records

Players should always know their best performances.

Examples:

Lowest Round

Lowest Tournament Score

Longest Drive

Longest Putt

Most Birdies

Best Finish

Fastest Round

Records provide long-term goals.

---

# Leaderboards

Existing Firebase leaderboards should remain.

Future additions:

Global

Friends

Weekly

Monthly

Tournament-specific

Course-specific

Players should always be able to compare themselves fairly.

---

# Tournament System

Players may create tournaments.

Tournament creator selects:

Course

Rules

Name

Start Date

End Date

Invite friends

Firebase generates a unique tournament ID.

Example:

JG-42M8PQ

The tournament creator receives a shareable invitation link.

---

# Tournament Invitations

Players may invite friends through:

Text Message

Email

Social Media

Messaging Apps

Friends open the invitation link.

The game launches directly into the tournament.

---

# Tournament Flow

Create Tournament

↓

Invite Friends

↓

Players Join

↓

Each Player Completes Round

↓

Scores Upload Automatically

↓

Leaderboard Updates

↓

Tournament Ends

↓

Winner Announced

No player needs to be online simultaneously.

---

# Tournament Rules

Supported options:

Stroke Play

Match Play (future)

Closest to Pin (future)

Longest Drive (future)

Players should compete asynchronously.

---

# Seasonal Events (Future)

Holiday tournaments

Limited cosmetics

Community challenges

Course rotations

Seasonal leaderboards

Seasonal content should feel special but should never create fear of missing out.

---

# Notifications

Optional notifications only.

Examples:

Tournament invitation

Tournament ending soon

Daily challenge available

Friend beat your score

Notifications should be useful rather than promotional.

---

# Player Profiles

Public profiles should display:

Display Name

Level

Favorite Golfer

Favorite Course

Career Statistics

Tournament Wins

Selected Cosmetics

Players may hide statistics if desired.

---

# Friends System (Future)

Players may:

Add friends

View friends' scores

Join tournaments

Compare statistics

View favorite golfers

No live multiplayer is required.

---

# Fair Play

Johnson's Golf should remain skill-based.

Cloud validation should prevent:

Impossible scores

Modified save data

Invalid tournament submissions

Future anti-cheat measures should prioritize fairness without inconveniencing honest players.

---

# Offline Play

The game should function without internet access.

Offline players may:

Play rounds

Earn local progress

View local statistics

Cloud synchronization should occur automatically when connectivity returns.

---

# Data Privacy

Collect only the information required to operate the game.

Never collect unnecessary personal information.

Player trust is essential.

---

# Future Expansion

The progression system should easily support:

New cosmetics

New achievements

New golfer unlocks

New tournaments

New statistics

New event types

Additional courses

Expanded social features

The database structure should not require major redesign to support future growth.

---

# Success Metrics

The progression system succeeds if players:

Return frequently.

Customize their golfer.

Enter tournaments.

Improve their scores.

Unlock cosmetics.

Advance levels.

Compete with friends.

Continue playing because golf itself remains enjoyable.

---

# Final Philosophy

Johnson's Golf should reward dedication without demanding it.

Players should feel that every round contributes toward something meaningful, whether that is improving their skills, unlocking a favorite cosmetic, climbing a leaderboard, or winning a tournament.

The progression system exists to celebrate the player's golfing journey—not to replace it.

Every online feature should reinforce the simple joy of playing one more round.
